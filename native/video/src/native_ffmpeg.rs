//! In-process FFmpeg backend.
//!
//! Direct FFmpeg ABI access stays in this module so the CLI backend continues
//! to compile and ship without loading the shared FFmpeg SDK.

use std::ffi::CString;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
#[cfg(target_os = "windows")]
use std::time::Duration;

use rsmpeg::avcodec::AVCodecContext;
use rsmpeg::avformat::AVFormatContextInput;
use rsmpeg::avutil::{AVFrame, AVHWDeviceContext};
use rsmpeg::error::RsmpegError;
use rsmpeg::ffi;
use rsmpeg::swscale::SwsContext;

#[cfg(target_os = "windows")]
use crate::d3d11_shared::SharedSurfacePool;

#[cfg(target_os = "windows")]
const SHARED_SURFACE_RETRY_DELAY: Duration = Duration::from_millis(2);

pub(crate) struct NativeDecodeRequest<'a> {
    pub(crate) source: &'a str,
    pub(crate) width: usize,
    pub(crate) height: usize,
    pub(crate) fps: f64,
    pub(crate) start_time: f64,
    pub(crate) looped: bool,
    pub(crate) hardware_decode: bool,
    pub(crate) shared_delivery: bool,
}

pub(crate) struct DecodedNv12Frame {
    pub(crate) timestamp_us: i64,
    pub(crate) data: Vec<u8>,
}

pub(crate) enum DecodedVideoFrame {
    Cpu(DecodedNv12Frame),
    #[cfg(target_os = "windows")]
    Shared {
        timestamp_us: i64,
        surface_id: u32,
        handle: usize,
    },
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
    #[cfg(target_os = "windows")] shared_pool: &Arc<Mutex<Option<SharedSurfacePool>>>,
    mut configured: impl FnMut(bool, bool),
    mut present: impl FnMut(DecodedVideoFrame) -> Result<(), String>,
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
    let mut timeline = PlaybackTimeline::new(request.start_time, request.fps);
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
                closed,
                #[cfg(target_os = "windows")]
                shared_pool,
                &mut timeline,
                &mut reported_hardware,
                &mut configured,
                &mut present,
            )?;
            if request.looped && !closed.load(Ordering::SeqCst) {
                input
                    .seek(stream_index as i32, 0, ffi::AVSEEK_FLAG_BACKWARD as i32)
                    .map_err(error_string)?;
                // avcodec_flush_buffers() is FFmpeg's supported reset after a
                // seek, including after the decoder has been drained at EOF.
                // Keep this context alive: reopening the D3D11VA decoder would
                // also create a new D3D11 device, invalidating the shared
                // presentation-surface pool owned by the current decoder.
                codec.flush_buffers();
                timeline.start_next_loop();
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
            closed,
            #[cfg(target_os = "windows")]
            shared_pool,
            &mut timeline,
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
    closed: &AtomicBool,
    #[cfg(target_os = "windows")] shared_pool: &Arc<Mutex<Option<SharedSurfacePool>>>,
    timeline: &mut PlaybackTimeline,
    reported_hardware: &mut Option<bool>,
    configured: &mut impl FnMut(bool, bool),
    present: &mut impl FnMut(DecodedVideoFrame) -> Result<(), String>,
) -> Result<(), String> {
    loop {
        let decoded = match codec.receive_frame() {
            Ok(frame) => frame,
            Err(RsmpegError::DecoderDrainError | RsmpegError::DecoderFlushedError) => return Ok(()),
            Err(error) => return Err(error_string(error)),
        };
        let hardware_decode = decoded.format == ffi::AV_PIX_FMT_D3D11;
        let timestamp_us = timeline.timestamp_us(decoded.pts, decoded.duration, time_base);

        #[cfg(target_os = "windows")]
        if hardware_decode && request.shared_delivery {
            if *reported_hardware != Some(true) {
                configured(true, true);
                *reported_hardware = Some(true);
            }
            let copied = wait_for_shared_surface(closed, || {
                let mut pool = shared_pool
                    .lock()
                    .map_err(|_| "Shared video surface pool lock poisoned".to_string())?;
                if pool.is_none() {
                    *pool = Some(SharedSurfacePool::from_decoded_frame(
                        &decoded,
                        request.width as u32,
                        request.height as u32,
                    )?);
                }
                pool.as_ref()
                    .expect("shared pool initialized above")
                    .copy_frame(&decoded)
            })?;
            match copied {
                Some(frame) => present(DecodedVideoFrame::Shared {
                    timestamp_us,
                    surface_id: frame.surface_id,
                    handle: frame.handle,
                })?,
                None => return Ok(()),
            }
            continue;
        }

        if *reported_hardware != Some(hardware_decode) {
            configured(hardware_decode, false);
            *reported_hardware = Some(hardware_decode);
        }
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

        present(DecodedVideoFrame::Cpu(DecodedNv12Frame {
            timestamp_us,
            data: copy_nv12(&nv12, request.width, request.height)?,
        }))?;
    }
}

#[cfg(target_os = "windows")]
fn wait_for_shared_surface<T>(
    closed: &AtomicBool,
    mut copy: impl FnMut() -> Result<Option<T>, String>,
) -> Result<Option<T>, String> {
    loop {
        if closed.load(Ordering::SeqCst) {
            return Ok(None);
        }
        if let Some(frame) = copy()? {
            return Ok(Some(frame));
        }
        // Native file decoding is intentionally unpaced. Backpressure here
        // prevents it from racing to EOF while Dawn still owns all bounded
        // presentation surfaces. Live/native delivery can add an explicit
        // drop policy when that backend becomes supported.
        std::thread::sleep(SHARED_SURFACE_RETRY_DELAY);
    }
}

/// Maintains the presentation timeline across demuxer seeks.
///
/// Container timestamps restart when a looping input seeks back to its first
/// packet. The JS presentation clock does not restart, so every pass after the
/// first one is rebased to begin one frame after the preceding pass.
struct PlaybackTimeline {
    fallback_start_us: i64,
    fallback_frame_duration_us: i64,
    frame_index_in_pass: i64,
    loop_offset_us: i64,
    next_loop_timestamp_us: Option<i64>,
    last_timestamp_us: Option<i64>,
    last_frame_duration_us: i64,
}

impl PlaybackTimeline {
    fn new(start_time: f64, fps: f64) -> Self {
        let fallback_frame_duration_us = (1_000_000.0 / fps).round() as i64;
        Self {
            fallback_start_us: (start_time * 1_000_000.0).round() as i64,
            fallback_frame_duration_us: fallback_frame_duration_us.max(1),
            frame_index_in_pass: 0,
            loop_offset_us: 0,
            next_loop_timestamp_us: None,
            last_timestamp_us: None,
            last_frame_duration_us: fallback_frame_duration_us.max(1),
        }
    }

    fn timestamp_us(
        &mut self,
        decoded_pts: i64,
        decoded_duration: i64,
        time_base: ffi::AVRational,
    ) -> i64 {
        let source_timestamp_us = if decoded_pts == ffi::AV_NOPTS_VALUE {
            self.fallback_start_us + self.frame_index_in_pass * self.fallback_frame_duration_us
        } else {
            // SAFETY: both rationals originate from FFmpeg and AV_TIME_BASE_Q
            // is the canonical microsecond time base.
            unsafe { ffi::av_rescale_q(decoded_pts, time_base, ffi::AV_TIME_BASE_Q) }
        };

        if self.frame_index_in_pass == 0 {
            if let Some(next_loop_timestamp_us) = self.next_loop_timestamp_us.take() {
                self.loop_offset_us = next_loop_timestamp_us - source_timestamp_us;
            }
        }

        let timestamp_us = source_timestamp_us + self.loop_offset_us;
        self.frame_index_in_pass += 1;
        self.last_timestamp_us = Some(timestamp_us);
        self.last_frame_duration_us = if decoded_duration > 0 {
            // SAFETY: same rational guarantees as the PTS conversion above.
            unsafe { ffi::av_rescale_q(decoded_duration, time_base, ffi::AV_TIME_BASE_Q) }.max(1)
        } else {
            self.fallback_frame_duration_us
        };
        timestamp_us
    }

    fn start_next_loop(&mut self) {
        self.next_loop_timestamp_us = self
            .last_timestamp_us
            .map(|timestamp_us| timestamp_us + self.last_frame_duration_us);
        self.frame_index_in_pass = 0;
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
    use std::path::PathBuf;

    #[test]
    fn links_against_ffmpeg_eight_avcodec() {
        assert_eq!(linked_avcodec_version() >> 16, 62);
    }

    #[test]
    fn loop_timestamps_continue_after_the_previous_frame() {
        let time_base = ffi::AVRational { num: 1, den: 1_000 };
        let mut timeline = PlaybackTimeline::new(0.0, 25.0);

        assert_eq!(timeline.timestamp_us(0, 40, time_base), 0);
        assert_eq!(timeline.timestamp_us(40, 40, time_base), 40_000);

        timeline.start_next_loop();
        assert_eq!(timeline.timestamp_us(0, 40, time_base), 80_000);
        assert_eq!(timeline.timestamp_us(40, 40, time_base), 120_000);

        timeline.start_next_loop();
        assert_eq!(timeline.timestamp_us(0, 40, time_base), 160_000);
    }

    #[test]
    fn loop_timestamps_rebase_non_zero_container_pts() {
        let time_base = ffi::AVRational { num: 1, den: 1_000 };
        let mut timeline = PlaybackTimeline::new(0.0, 30.0);

        assert_eq!(timeline.timestamp_us(10_000, 0, time_base), 10_000_000);
        timeline.start_next_loop();
        assert_eq!(timeline.timestamp_us(10_000, 0, time_base), 10_033_333);
    }

    #[test]
    fn loop_timestamps_rebase_frames_without_pts() {
        let time_base = ffi::AVRational { num: 1, den: 1 };
        let mut timeline = PlaybackTimeline::new(0.0, 2.0);

        assert_eq!(timeline.timestamp_us(ffi::AV_NOPTS_VALUE, 0, time_base), 0);
        assert_eq!(
            timeline.timestamp_us(ffi::AV_NOPTS_VALUE, 0, time_base),
            500_000
        );
        timeline.start_next_loop();
        assert_eq!(
            timeline.timestamp_us(ffi::AV_NOPTS_VALUE, 0, time_base),
            1_000_000
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn shared_surface_backpressure_retries_the_same_frame() {
        let closed = AtomicBool::new(false);
        let mut attempts = 0;
        let frame = wait_for_shared_surface(&closed, || {
            attempts += 1;
            Ok((attempts == 3).then_some(7))
        })
        .expect("surface retry should succeed");

        assert_eq!(frame, Some(7));
        assert_eq!(attempts, 3);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn shared_surface_backpressure_stops_during_shutdown() {
        let closed = AtomicBool::new(true);
        let mut attempted = false;
        let frame = wait_for_shared_surface(&closed, || {
            attempted = true;
            Ok(Some(7))
        })
        .expect("shutdown should be clean");

        assert_eq!(frame, None);
        assert!(!attempted);
    }

    #[test]
    fn native_loop_decodes_a_second_pass_with_monotonic_timestamps() {
        let source = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../tests/fixtures/hevc-one-frame.mp4")
            .to_string_lossy()
            .into_owned();
        let request = NativeDecodeRequest {
            source: &source,
            width: 32,
            height: 32,
            fps: 1.0,
            start_time: 0.0,
            looped: true,
            hardware_decode: false,
            shared_delivery: false,
        };
        let closed = AtomicBool::new(false);
        #[cfg(target_os = "windows")]
        let shared_pool = Arc::new(Mutex::new(None));
        let mut timestamps = Vec::new();

        decode_nv12(
            &request,
            &closed,
            #[cfg(target_os = "windows")]
            &shared_pool,
            |_, _| {},
            |frame| {
                if let DecodedVideoFrame::Cpu(frame) = frame {
                    timestamps.push(frame.timestamp_us);
                    if timestamps.len() == 2 {
                        closed.store(true, Ordering::SeqCst);
                    }
                }
                Ok(())
            },
        )
        .expect("looping fixture should decode");

        assert_eq!(timestamps, vec![0, 1_000_000]);
    }
}
