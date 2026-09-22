use std::mem::ManuallyDrop;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use rsmpeg::avutil::AVFrame;
use windows::core::{Interface, PCWSTR};
use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_TIMEOUT};
use windows::Win32::Graphics::Direct3D11::{
    ID3D11Device, ID3D11DeviceContext, ID3D11Resource, ID3D11Texture2D, D3D11_BIND_SHADER_RESOURCE,
    D3D11_BOX, D3D11_RESOURCE_MISC_SHARED_KEYEDMUTEX, D3D11_RESOURCE_MISC_SHARED_NTHANDLE,
    D3D11_TEXTURE2D_DESC, D3D11_USAGE_DEFAULT,
};
use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_NV12, DXGI_SAMPLE_DESC};
use windows::Win32::Graphics::Dxgi::{
    IDXGIKeyedMutex, IDXGIResource1, DXGI_SHARED_RESOURCE_READ, DXGI_SHARED_RESOURCE_WRITE,
};

const PRESENTATION_SURFACE_COUNT: usize = 4;

pub(crate) struct SharedFrame {
    pub(crate) surface_id: u32,
    pub(crate) handle: usize,
}

struct Surface {
    texture: ID3D11Texture2D,
    mutex: IDXGIKeyedMutex,
    handle: HANDLE,
    leased: Arc<AtomicBool>,
}

pub(crate) struct SharedSurfacePool {
    context: ID3D11DeviceContext,
    surfaces: Vec<Surface>,
    width: u32,
    height: u32,
}

unsafe impl Send for SharedSurfacePool {}

impl SharedSurfacePool {
    pub(crate) fn from_decoded_frame(frame: &AVFrame) -> Result<Self, String> {
        let source = borrowed_texture(frame)?;
        let mut source_desc = D3D11_TEXTURE2D_DESC::default();
        unsafe { source.GetDesc(&mut source_desc) };
        let width = u32::try_from(frame.width)
            .map_err(|_| format!("D3D11VA frame width must be positive, got {}", frame.width))?;
        let height = u32::try_from(frame.height).map_err(|_| {
            format!(
                "D3D11VA frame height must be positive, got {}",
                frame.height
            )
        })?;
        if width == 0
            || height == 0
            || width % 2 != 0
            || height % 2 != 0
            || source_desc.Format != DXGI_FORMAT_NV12
            || width > source_desc.Width
            || height > source_desc.Height
        {
            return Err(format!(
                "D3D11VA output cannot use the shared NV12 path: format={:?}, frame={}x{}, texture={}x{}",
                source_desc.Format,
                frame.width,
                frame.height,
                source_desc.Width,
                source_desc.Height
            ));
        }

        let device = unsafe { source.GetDevice() }.map_err(|error| error.to_string())?;
        let context = unsafe { device.GetImmediateContext() }.map_err(|error| error.to_string())?;

        let desc = D3D11_TEXTURE2D_DESC {
            Width: width,
            Height: height,
            MipLevels: 1,
            ArraySize: 1,
            Format: DXGI_FORMAT_NV12,
            SampleDesc: DXGI_SAMPLE_DESC {
                Count: 1,
                Quality: 0,
            },
            Usage: D3D11_USAGE_DEFAULT,
            BindFlags: D3D11_BIND_SHADER_RESOURCE.0 as u32,
            CPUAccessFlags: 0,
            MiscFlags: (D3D11_RESOURCE_MISC_SHARED_NTHANDLE | D3D11_RESOURCE_MISC_SHARED_KEYEDMUTEX)
                .0 as u32,
        };
        let mut surfaces = Vec::with_capacity(PRESENTATION_SURFACE_COUNT);
        for _ in 0..PRESENTATION_SURFACE_COUNT {
            surfaces.push(create_surface(&device, &desc)?);
        }
        Ok(Self {
            context,
            surfaces,
            width,
            height,
        })
    }

    pub(crate) fn copy_frame(&self, frame: &AVFrame) -> Result<Option<SharedFrame>, String> {
        let source = borrowed_texture(frame)?;
        let source_index = frame.data[1] as usize as u32;
        let source_box = D3D11_BOX {
            left: 0,
            top: 0,
            front: 0,
            right: self.width,
            bottom: self.height,
            back: 1,
        };
        for (surface_id, surface) in self.surfaces.iter().enumerate() {
            if surface
                .leased
                .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                .is_err()
            {
                continue;
            }
            match try_acquire(&surface.mutex)? {
                true => {
                    let destination: ID3D11Resource =
                        surface.texture.cast().map_err(|error| error.to_string())?;
                    let source_resource: ID3D11Resource =
                        source.cast().map_err(|error| error.to_string())?;
                    unsafe {
                        self.context.CopySubresourceRegion(
                            &destination,
                            0,
                            0,
                            0,
                            0,
                            &source_resource,
                            source_index,
                            Some(&source_box),
                        );
                        self.context.Flush();
                    }
                    if let Err(error) = unsafe { surface.mutex.ReleaseSync(0) } {
                        surface.leased.store(false, Ordering::Release);
                        return Err(error.to_string());
                    }
                    return Ok(Some(SharedFrame {
                        surface_id: surface_id as u32,
                        handle: surface.handle.0 as usize,
                    }));
                }
                false => {
                    surface.leased.store(false, Ordering::Release);
                }
            }
        }
        Ok(None)
    }

    pub(crate) fn release(&self, surface_id: u32) -> bool {
        let Some(surface) = self.surfaces.get(surface_id as usize) else {
            return false;
        };
        surface.leased.swap(false, Ordering::AcqRel)
    }
}

fn try_acquire(mutex: &IDXGIKeyedMutex) -> Result<bool, String> {
    // windows-rs maps every non-negative HRESULT to Ok(()), but DXGI returns
    // WAIT_TIMEOUT (0x102) as a successful HRESULT when a zero-timeout acquire
    // cannot take the mutex. Preserve the raw result so timeout never reaches
    // CopySubresourceRegion/ReleaseSync as if ownership had been acquired.
    let status = unsafe { (Interface::vtable(mutex).AcquireSync)(Interface::as_raw(mutex), 0, 0) };
    if status.0 == 0 {
        return Ok(true);
    }
    if status.0 as u32 == WAIT_TIMEOUT.0 {
        return Ok(false);
    }
    Err(windows::core::Error::from_hresult(status).to_string())
}

impl Drop for Surface {
    fn drop(&mut self) {
        if !self.handle.is_invalid() {
            unsafe {
                let _ = CloseHandle(self.handle);
            }
        }
    }
}

fn create_surface(device: &ID3D11Device, desc: &D3D11_TEXTURE2D_DESC) -> Result<Surface, String> {
    let mut texture = None;
    unsafe { device.CreateTexture2D(desc, None, Some(&mut texture)) }
        .map_err(|error| error.to_string())?;
    let texture =
        texture.ok_or_else(|| "D3D11 did not return a presentation texture".to_string())?;
    let resource: IDXGIResource1 = texture.cast().map_err(|error| error.to_string())?;
    let handle = unsafe {
        resource.CreateSharedHandle(
            None,
            DXGI_SHARED_RESOURCE_READ | DXGI_SHARED_RESOURCE_WRITE,
            PCWSTR::null(),
        )
    }
    .map_err(|error| error.to_string())?;
    let mutex: IDXGIKeyedMutex = texture.cast().map_err(|error| error.to_string())?;
    Ok(Surface {
        texture,
        mutex,
        handle,
        leased: Arc::new(AtomicBool::new(false)),
    })
}

fn borrowed_texture(frame: &AVFrame) -> Result<ManuallyDrop<ID3D11Texture2D>, String> {
    let pointer = frame.data[0] as *mut core::ffi::c_void;
    if pointer.is_null() {
        return Err("D3D11VA frame has no texture".to_string());
    }
    Ok(ManuallyDrop::new(unsafe {
        ID3D11Texture2D::from_raw(pointer)
    }))
}
