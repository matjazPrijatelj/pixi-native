//! In-process FFmpeg backend.
//!
//! Direct FFmpeg ABI access stays in this module so the CLI backend continues
//! to compile and ship without loading the shared FFmpeg SDK.

use std::ffi::CString;
use std::sync::atomic::{AtomicBool, Ordering};

use rsmpeg::avcodec::AVCodecContext;
use rsmpeg::avformat::AVFormatContextInput;
use rsmpeg::avutil::{AVFrame, AVHWDeviceContext};
use rsmpeg::error::RsmpegError;
use rsmpeg::ffi;
use rsmpeg::swscale::SwsContext;

pub(crate) struct NativeDecodeRequest<'a> {
    pub(crate) source: &'a str,
    pub(crate) width: usize,
    pub(crate) height: usize,
    pub(crate) fps: f64,
    pub(crate) start_time: f64,
    pub(crate) looped: bool,
    pub(crate) hardware_decode: bool,
}

pub(crate) struct DecodedNv12Frame {
    pub(crate) timestamp_us: i64,
    pub(crate) data: Vec<u8>,
}

#[cfg(test)]
pub(crate) fn linked_avcodec_version() -> u32 {
    // SAFETY: avcodec_version has no parameters and only reads FFmpeg's static
    // version data. A successful load establishes the ABI boundary.
    unsafe { ffi::avcodec_version() }
}

pub(crate) fn decode_nv12(
    request: &NativeDecodeRequest<'_>,
    closed: &AtomicBool,
    mut configured: impl FnMut(bool),
    mut present: impl FnMut(DecodedNv12Frame) -> Result<(), String>,
) -> Result<(), String> {
    if std::env::var("PIXI_NATIVE_VIDEO_FFMPEG_LOG").is_ok_and(|value| value == "debug") {
        // SAFETY: FFmpeg logging level is a process-wide atomic-style setting;
        // this diagnostic opt-in is applied before opening decoder contexts.
        unsafe { ffi::av_log_set_level(ffi::AV_LOG_DEBUG as i32) };
    }
    let source =
        CString::new(request.source).map_err(|_| "Video source contains NUL".to_string())?;
    let mut input = AVFormatContextInput::open(&source).map_err(error_string)?;
    let (stream_index, decoder) = input
        .find_best_stream(ffi::AVMEDIA_TYPE_VIDEO)
        .map_err(error_string)?
        .ok_or_else(|| "No decodable video stream found".to_string())?;
    let stream = &input.streams()[stream_index];
    let time_base = stream.time_base;
    let mut codec = AVCodecContext::new(&decoder);
    codec
        .apply_codecpar(&stream.codecpar())
        .map_err(error_string)?;
    configure_hardware_decoder(&mut codec, request.hardware_decode);
    codec.open(None).map_err(error_string)?;
    if request.start_time > 0.0 {
        let timestamp_us = (request.start_time * 1_000_000.0).round() as i64;
        // SAFETY: av_rescale_q is a pure integer rescale over valid FFmpeg
        // rationals obtained from the selected stream.
        let stream_timestamp =
            unsafe { ffi::av_rescale_q(timestamp_us, ffi::AV_TIME_BASE_Q, time_base) };
        input
            .seek(
                stream_index as i32,
                stream_timestamp,
                ffi::AVSEEK_FLAG_BACKWARD as i32,
            )
            .map_err(error_string)?;
    }

    let width = i32::try_from(request.width).map_err(|error| error.to_string())?;
    let height = i32::try_from(request.height).map_err(|error| error.to_string())?;
    let mut scaler: Option<SwsContext> = None;
    let mut frame_index = 0_i64;
    let mut reported_hardware = None;

    while !closed.load(Ordering::SeqCst) {
        let Some(packet) = input.read_packet().map_err(error_string)? else {
            codec.send_packet(None).map_err(error_string)?;
            drain_frames(
                &mut codec,
                &mut scaler,
                width,
                height,
                time_base,
                request,
                &mut frame_index,
                &mut reported_hardware,
                &mut configured,
                &mut present,
            )?;
            if request.looped && !closed.load(Ordering::SeqCst) {
                input
                    .seek(stream_index as i32, 0, ffi::AVSEEK_FLAG_BACKWARD as i32)
                    .map_err(error_string)?;
                codec.flush_buffers();
                frame_index = 0;
                continue;
            }
            return Ok(());
        };
        if packet.stream_index != stream_index as i32 {
            continue;
        }
        codec.send_packet(Some(&packet)).map_err(error_string)?;
        drain_frames(
            &mut codec,
            &mut scaler,
            width,
            height,
            time_base,
            request,
            &mut frame_index,
            &mut reported_hardware,
            &mut configured,
            &mut present,
        )?;
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn drain_frames(
    codec: &mut AVCodecContext,
    scaler: &mut Option<SwsContext>,
    width: i32,
    height: i32,
    time_base: ffi::AVRational,
    request: &NativeDecodeRequest<'_>,
    frame_index: &mut i64,
    reported_hardware: &mut Option<bool>,
    configured: &mut impl FnMut(bool),
    present: &mut impl FnMut(DecodedNv12Frame) -> Result<(), String>,
) -> Result<(), String> {
    loop {
        let decoded = match codec.receive_frame() {
            Ok(frame) => frame,
            Err(RsmpegError::DecoderDrainError | RsmpegError::DecoderFlushedError) => return Ok(()),
            Err(error) => return Err(error_string(error)),
        };
        let hardware_decode = decoded.format == ffi::AV_PIX_FMT_D3D11;
        if *reported_hardware != Some(hardware_decode) {
            configured(hardware_decode);
            *reported_hardware = Some(hardware_decode);
        }
        let decoded_pts = decoded.pts;
        let transferred = if decoded.format == ffi::AV_PIX_FMT_D3D11 {
            let mut software = AVFrame::new();
            software
                .hwframe_transfer_data(&decoded)
                .map_err(error_string)?;
            Some(software)
        } else {
            None
        };
        let decoded = transferred.as_ref().unwrap_or(&decoded);
        if scaler.is_none() {
            *scaler = SwsContext::get_context(
                decoded.width,
                decoded.height,
                decoded.format,
                width,
                height,
                ffi::AV_PIX_FMT_NV12,
                ffi::SWS_BILINEAR,
                None,
                None,
                None,
            );
        }
        let scaler = scaler
            .as_mut()
            .ok_or_else(|| "Could not create FFmpeg NV12 scaler".to_string())?;
        let mut nv12 = AVFrame::new();
        nv12.set_format(ffi::AV_PIX_FMT_NV12);
        nv12.set_width(width);
        nv12.set_height(height);
        nv12.get_buffer(32).map_err(error_string)?;
        scaler
            .scale_frame(&decoded, 0, decoded.height, &mut nv12)
            .map_err(error_string)?;

        let timestamp_us = if decoded_pts == ffi::AV_NOPTS_VALUE {
            (request.start_time * 1_000_000.0 + *frame_index as f64 * 1_000_000.0 / request.fps)
                .round() as i64
        } else {
            // SAFETY: both rationals originate from FFmpeg and AV_TIME_BASE_Q
            // is the canonical microsecond time base.
            unsafe { ffi::av_rescale_q(decoded_pts, time_base, ffi::AV_TIME_BASE_Q) }
        };
        *frame_index += 1;
        present(DecodedNv12Frame {
            timestamp_us,
            data: copy_nv12(&nv12, request.width, request.height)?,
        })?;
    }
}

fn configure_hardware_decoder(codec: &mut AVCodecContext, requested: bool) -> bool {
    #[cfg(target_os = "windows")]
    if requested {
        let Ok(device) = AVHWDeviceContext::create(ffi::AV_HWDEVICE_TYPE_D3D11VA, None, None, 0)
        else {
            return false;
        };
        // FFmpeg's D3D11VA pool is static. Keep enough presentation slack for
        // H.264/H.265 DPB and frame threading so decoding cannot exhaust the
        // pool before the first displayable frame is returned.
        // SAFETY: codec owns a live AVCodecContext and this field is intended
        // to be configured by the caller before avcodec_open2.
        unsafe { (*codec.as_mut_ptr()).extra_hw_frames = 16 };
        codec.set_get_format(Some(select_d3d11_format));
        codec.set_hw_device_ctx(device);
        return true;
    }
    false
}

#[cfg(target_os = "windows")]
unsafe extern "C" fn select_d3d11_format(
    _context: *mut ffi::AVCodecContext,
    formats: *const ffi::AVPixelFormat,
) -> ffi::AVPixelFormat {
    let mut current = formats;
    let mut software_fallback = ffi::AV_PIX_FMT_NONE;
    while !current.is_null() && unsafe { *current } != ffi::AV_PIX_FMT_NONE {
        let format = unsafe { *current };
        if format == ffi::AV_PIX_FMT_D3D11 {
            return ffi::AV_PIX_FMT_D3D11;
        }
        if software_fallback == ffi::AV_PIX_FMT_NONE {
            software_fallback = format;
        }
        current = unsafe { current.add(1) };
    }
    software_fallback
}

fn copy_nv12(frame: &AVFrame, width: usize, height: usize) -> Result<Vec<u8>, String> {
    let y_stride = usize::try_from(frame.linesize[0]).map_err(|error| error.to_string())?;
    let uv_stride = usize::try_from(frame.linesize[1]).map_err(|error| error.to_string())?;
    if frame.data[0].is_null() || frame.data[1].is_null() || y_stride < width || uv_stride < width {
        return Err("FFmpeg returned an invalid NV12 frame layout".to_string());
    }
    let mut output = vec![0; width * height * 3 / 2];
    for row in 0..height {
        // SAFETY: FFmpeg guarantees linesize * plane-height readable bytes;
        // the layout checks above constrain every row copy.
        unsafe {
            std::ptr::copy_nonoverlapping(
                frame.data[0].add(row * y_stride),
                output.as_mut_ptr().add(row * width),
                width,
            );
        }
    }
    let uv_offset = width * height;
    for row in 0..height / 2 {
        // SAFETY: same plane bounds argument as the luma copy above.
        unsafe {
            std::ptr::copy_nonoverlapping(
                frame.data[1].add(row * uv_stride),
                output.as_mut_ptr().add(uv_offset + row * width),
                width,
            );
        }
    }
    Ok(output)
}

fn error_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn links_against_ffmpeg_eight_avcodec() {
        assert_eq!(linked_avcodec_version() >> 16, 62);
    }
}
