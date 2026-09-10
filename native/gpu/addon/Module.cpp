#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdlib>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <limits>
#include <map>
#include <memory>
#include <optional>
#include <sstream>
#include <string>
#include <string_view>
#include <tuple>
#include <utility>
#include <vector>

#include "dawn/dawn_proc.h"
#include "dawn/native/DawnNative.h"
#include "src/dawn/node/binding/AsyncRunner.h"
#include "src/dawn/node/binding/Converter.h"
#include "src/dawn/node/binding/Flags.h"
#include "src/dawn/node/binding/GPUAdapter.h"
#include "src/dawn/node/binding/GPUDevice.h"
#include "src/dawn/node/binding/GPUTexture.h"
#include "src/dawn/node/binding/GPUTextureView.h"
#include "src/dawn/node/binding/TogglesLoader.h"
#include "src/dawn/node/interop/WebGPU.h"

#if defined(_WIN32)
#include <windows.h>
#elif defined(__linux__)
#include <X11/Xlib.h>
#endif

namespace {

using wgpu::binding::AsyncRunner;
using wgpu::binding::Flags;
using DeviceLostPromise =
    wgpu::interop::Promise<wgpu::interop::Interface<wgpu::interop::GPUDeviceLostInfo>>;

const DawnProcTable* gProcs = nullptr;
Napi::FunctionReference gRendererConstructor;

const char* SurfaceTextureStatusName(WGPUSurfaceGetCurrentTextureStatus status) {
    switch (status) {
        case WGPUSurfaceGetCurrentTextureStatus_SuccessOptimal:
            return "success-optimal";
        case WGPUSurfaceGetCurrentTextureStatus_SuccessSuboptimal:
            return "success-suboptimal";
        case WGPUSurfaceGetCurrentTextureStatus_Timeout:
            return "timeout";
        case WGPUSurfaceGetCurrentTextureStatus_Outdated:
            return "outdated";
        case WGPUSurfaceGetCurrentTextureStatus_Lost:
            return "lost";
        case WGPUSurfaceGetCurrentTextureStatus_Error:
            return "error";
        default:
            return "unknown";
    }
}

const std::map<std::string, WGPUPresentMode> kPresentModes = {
    {"fifo", WGPUPresentMode_Fifo},
    {"fifoRelaxed", WGPUPresentMode_FifoRelaxed},
    {"immediate", WGPUPresentMode_Immediate},
    {"mailbox", WGPUPresentMode_Mailbox},
};

const std::map<std::string, WGPUCompositeAlphaMode> kAlphaModes = {
    {"opaque", WGPUCompositeAlphaMode_Opaque},
    {"premultiplied", WGPUCompositeAlphaMode_Premultiplied},
};

struct BackendInfo {
    const char* name;
    const char* alias;
    wgpu::BackendType backend;
};

constexpr BackendInfo kBackends[] = {
    {"null", nullptr, wgpu::BackendType::Null},
    {"webgpu", nullptr, wgpu::BackendType::WebGPU},
    {"d3d11", nullptr, wgpu::BackendType::D3D11},
    {"d3d12", "d3d", wgpu::BackendType::D3D12},
    {"metal", nullptr, wgpu::BackendType::Metal},
    {"vulkan", "vk", wgpu::BackendType::Vulkan},
};

struct NativeGpuContext {
    Flags flags;
    std::unique_ptr<dawn::native::Instance> instance;
    std::shared_ptr<AsyncRunner> async;
    dawn::native::Adapter nativeAdapter;
    wgpu::Adapter adapter;
    wgpu::Device device;
    std::optional<DeviceLostPromise> lostPromise;
};

struct DeviceLostContext {
    Napi::Env env;
    DeviceLostPromise promise;
};

std::string GetEnvironmentVariable(const char* name) {
#if defined(_WIN32)
    char* value = nullptr;
    size_t length = 0;
    _dupenv_s(&value, &length, name);
    std::unique_ptr<char, decltype(&free)> owned(value, &free);
    return value == nullptr ? std::string() : std::string(value);
#else
    const char* value = std::getenv(name);
    return value == nullptr ? std::string() : std::string(value);
#endif
}

std::optional<wgpu::BackendType> ParseBackend(std::string_view name) {
    for (const auto& info : kBackends) {
        if (name == info.name || (info.alias != nullptr && name == info.alias)) {
            return info.backend;
        }
    }
    return std::nullopt;
}

std::optional<Flags> ParseFlags(Napi::Env env, Napi::Value value) {
    if (!value.IsArray()) {
        Napi::TypeError::New(env, "flags must be an array of key=value strings")
            .ThrowAsJavaScriptException();
        return std::nullopt;
    }
    Flags flags;
    Napi::Array values = value.As<Napi::Array>();
    for (uint32_t index = 0; index < values.Length(); ++index) {
        if (!values.Get(index).IsString()) {
            Napi::TypeError::New(env, "flags must contain only strings")
                .ThrowAsJavaScriptException();
            return std::nullopt;
        }
        const std::string flag = values.Get(index).As<Napi::String>().Utf8Value();
        const size_t separator = flag.find('=');
        if (separator == std::string::npos) {
            Napi::TypeError::New(env, "flags must use key=value syntax")
                .ThrowAsJavaScriptException();
            return std::nullopt;
        }
        flags.Set(flag.substr(0, separator), flag.substr(separator + 1));
    }
    return flags;
}

std::optional<wgpu::BackendType> ResolveBackend(Napi::Env env, const Flags& flags) {
#if defined(_WIN32)
    wgpu::BackendType backend = wgpu::BackendType::D3D12;
#elif defined(__linux__)
    wgpu::BackendType backend = wgpu::BackendType::Vulkan;
#elif defined(__APPLE__)
    wgpu::BackendType backend = wgpu::BackendType::Metal;
#else
#error "Unsupported platform"
#endif
    std::string name = flags.Get("backend").value_or(GetEnvironmentVariable("DAWNNODE_BACKEND"));
    std::transform(name.begin(), name.end(), name.begin(),
                   [](unsigned char character) { return std::tolower(character); });
    if (name.empty()) return backend;
    const auto parsed = ParseBackend(name);
    if (!parsed.has_value()) {
        Napi::Error::New(env, "unrecognised backend '" + name + "'")
            .ThrowAsJavaScriptException();
        return std::nullopt;
    }
    return *parsed;
}

std::shared_ptr<NativeGpuContext> CreateNativeContext(Napi::Env env, Flags flags) {
    auto context = std::make_shared<NativeGpuContext>();
    context->flags = std::move(flags);

    dawn::native::DawnInstanceDescriptor dawnDescriptor;
    if (const auto validate = context->flags.Get("validate");
        validate == "1" || validate == "true") {
        dawnDescriptor.backendValidationLevel = dawn::native::BackendValidationLevel::Full;
    }
    wgpu::binding::TogglesLoader togglesLoader(context->flags);
    wgpu::DawnTogglesDescriptor toggles = togglesLoader.GetDescriptor();
    toggles.nextInChain = &dawnDescriptor;
    wgpu::InstanceDescriptor instanceDescriptor;
    instanceDescriptor.nextInChain = &toggles;
    context->instance = std::make_unique<dawn::native::Instance>(
        reinterpret_cast<const WGPUInstanceDescriptor*>(&instanceDescriptor));
    context->async = AsyncRunner::Create(context->instance.get());

    wgpu::RequestAdapterOptions adapterOptions;
    adapterOptions.featureLevel = wgpu::FeatureLevel::Core;
    const auto backend = ResolveBackend(env, context->flags);
    if (!backend.has_value()) return nullptr;
    adapterOptions.backendType = *backend;
    wgpu::DawnTogglesDescriptor adapterToggles = togglesLoader.GetDescriptor();
    adapterOptions.nextInChain = &adapterToggles;
    auto adapters = context->instance->EnumerateAdapters(&adapterOptions);
    if (adapters.empty()) {
        Napi::Error::New(env, "no native WebGPU adapter found").ThrowAsJavaScriptException();
        return nullptr;
    }

    const std::string requestedName = context->flags.Get("adapter").value_or("");
    for (const auto& candidate : adapters) {
        wgpu::Adapter adapter(candidate.Get());
        wgpu::AdapterInfo info;
        adapter.GetInfo(&info);
        if (!requestedName.empty() &&
            std::string_view(info.device).find(requestedName) == std::string_view::npos) {
            continue;
        }
        context->nativeAdapter = candidate;
        context->adapter = std::move(adapter);
        if (context->flags.Get("verbose").has_value()) {
            std::cout << "using GPU adapter: " << info.device << "\n";
        }
        break;
    }
    if (!context->adapter) {
        Napi::Error::New(env, "requested native WebGPU adapter not found")
            .ThrowAsJavaScriptException();
        return nullptr;
    }

    wgpu::DeviceDescriptor deviceDescriptor;
    wgpu::DawnTogglesDescriptor deviceToggles = togglesLoader.GetDescriptor();
    deviceDescriptor.nextInChain = &deviceToggles;
    deviceDescriptor.SetUncapturedErrorCallback(
        wgpu::binding::GPUDevice::handleUncapturedErrorCallback);
    context->lostPromise.emplace(env, PROMISE_INFO);
    deviceDescriptor.SetDeviceLostCallback(
        wgpu::CallbackMode::AllowSpontaneous,
        [](const wgpu::Device&, wgpu::DeviceLostReason reason, wgpu::StringView message,
           DeviceLostContext* rawContext) {
            std::unique_ptr<DeviceLostContext> lostContext(rawContext);
            auto mappedReason = wgpu::interop::GPUDeviceLostReason::kUnknown;
            if (reason == wgpu::DeviceLostReason::Destroyed ||
                reason == wgpu::DeviceLostReason::CallbackCancelled) {
                mappedReason = wgpu::interop::GPUDeviceLostReason::kDestroyed;
            }
            if (lostContext->promise.GetState() == wgpu::interop::PromiseState::Pending) {
                lostContext->promise.Resolve(
                    wgpu::interop::GPUDeviceLostInfo::Create<wgpu::binding::GPUDeviceLostInfo>(
                        lostContext->env, mappedReason, std::string(message)));
            }
        },
        new DeviceLostContext{env, *context->lostPromise});
    WGPUDevice rawDevice = context->nativeAdapter.CreateDevice(&deviceDescriptor);
    if (rawDevice == nullptr) {
        context->lostPromise->Discard();
        Napi::Error::New(env, "native WebGPU device creation failed").ThrowAsJavaScriptException();
        return nullptr;
    }
    context->device = wgpu::Device::Acquire(rawDevice);
    return context;
}

template <typename T>
Napi::External<std::shared_ptr<T>> SharedExternal(Napi::Env env, std::shared_ptr<T> value) {
    return Napi::External<std::shared_ptr<T>>::New(
        env, new std::shared_ptr<T>(std::move(value)),
        [](Napi::Env, std::shared_ptr<T>* pointer) { delete pointer; });
}

std::optional<uintptr_t> DecodeNativeHandle(Napi::Env env,
                                            const Napi::Value& value,
                                            const char* name) {
    if (!value.IsTypedArray() ||
        value.As<Napi::TypedArray>().TypedArrayType() != napi_uint8_array) {
        Napi::TypeError::New(env, std::string(name) + " must be a Uint8Array")
            .ThrowAsJavaScriptException();
        return std::nullopt;
    }
    Napi::Uint8Array bytes = value.As<Napi::Uint8Array>();
    if (bytes.ByteLength() != sizeof(uintptr_t)) {
        Napi::TypeError::New(
            env,
            std::string(name) + " must contain exactly " +
                std::to_string(sizeof(uintptr_t)) + " bytes")
            .ThrowAsJavaScriptException();
        return std::nullopt;
    }
    uintptr_t handle = 0;
    const auto* data = static_cast<const uint8_t*>(bytes.ArrayBuffer().Data()) +
        bytes.ByteOffset();
    std::memcpy(&handle, data, sizeof(handle));
    if (handle == 0) {
        Napi::TypeError::New(env, std::string(name) + " must not be null")
            .ThrowAsJavaScriptException();
        return std::nullopt;
    }
    return handle;
}

std::optional<uint32_t> DecodeSurfaceDimension(Napi::Env env,
                                               const Napi::Value& value,
                                               const char* name) {
    if (!value.IsNumber()) {
        Napi::TypeError::New(env, std::string(name) + " must be a number")
            .ThrowAsJavaScriptException();
        return std::nullopt;
    }
    const double dimension = value.As<Napi::Number>().DoubleValue();
    if (!std::isfinite(dimension) || dimension < 1 ||
        dimension > std::numeric_limits<uint32_t>::max()) {
        Napi::RangeError::New(env, std::string(name) + " is out of range")
            .ThrowAsJavaScriptException();
        return std::nullopt;
    }
    return static_cast<uint32_t>(dimension);
}

WGPUSurface CreateWindowSurface(Napi::Env env,
                                WGPUInstance instance,
                                const Napi::Object& surfaceDescriptor) {
    if (!surfaceDescriptor.Get("platform").IsString()) {
        Napi::TypeError::New(env, "surface.platform must be a string")
            .ThrowAsJavaScriptException();
        return nullptr;
    }
    const std::string platform =
        surfaceDescriptor.Get("platform").As<Napi::String>().Utf8Value();
    const auto windowHandle = DecodeNativeHandle(
        env, surfaceDescriptor.Get("window"), "surface.window");
    if (!windowHandle.has_value()) return nullptr;

#if defined(_WIN32)
    if (platform != "win32") {
        Napi::TypeError::New(env, "Windows requires a win32 surface")
            .ThrowAsJavaScriptException();
        return nullptr;
    }
    WGPUSurfaceDescriptor descriptor = {};
    WGPUSurfaceSourceWindowsHWND source = {};
    source.chain.sType = WGPUSType_SurfaceSourceWindowsHWND;
    source.hwnd = reinterpret_cast<HWND>(*windowHandle);
    source.hinstance = GetModuleHandleW(nullptr);
    descriptor.nextInChain = &source.chain;
    return gProcs->instanceCreateSurface(instance, &descriptor);
#elif defined(__linux__)
    const auto displayHandle = DecodeNativeHandle(
        env, surfaceDescriptor.Get("display"), "surface.display");
    if (!displayHandle.has_value()) return nullptr;
    WGPUSurfaceDescriptor descriptor = {};
    if (platform == "x11") {
        WGPUSurfaceSourceXlibWindow source = {};
        source.chain.sType = WGPUSType_SurfaceSourceXlibWindow;
        source.display = reinterpret_cast<Display*>(*displayHandle);
        source.window = static_cast<Window>(*windowHandle);
        descriptor.nextInChain = &source.chain;
        return gProcs->instanceCreateSurface(instance, &descriptor);
    }
    if (platform == "wayland") {
        WGPUSurfaceSourceWaylandSurface source = {};
        source.chain.sType = WGPUSType_SurfaceSourceWaylandSurface;
        source.display = reinterpret_cast<void*>(*displayHandle);
        source.surface = reinterpret_cast<void*>(*windowHandle);
        descriptor.nextInChain = &source.chain;
        return gProcs->instanceCreateSurface(instance, &descriptor);
    }
    Napi::TypeError::New(env, "Linux requires an x11 or wayland surface")
        .ThrowAsJavaScriptException();
    return nullptr;
#else
    Napi::Error::New(env, "Native WebGPU surfaces are unsupported on this platform")
        .ThrowAsJavaScriptException();
    return nullptr;
#endif
}

class Renderer final : public Napi::ObjectWrap<Renderer> {
  public:
    static void Init(Napi::Env env) {
        Napi::Function constructor = DefineClass(env, "Renderer", {
            InstanceMethod("getPreferredFormat", &Renderer::GetPreferredFormat),
            InstanceMethod("getAlphaMode", &Renderer::GetAlphaMode),
            InstanceMethod("getCurrentTexture", &Renderer::GetCurrentTexture),
            InstanceMethod("getCurrentTextureView", &Renderer::GetCurrentTextureView),
            InstanceMethod("swap", &Renderer::Swap),
            InstanceMethod("resize", &Renderer::Resize),
            InstanceMethod("destroy", &Renderer::Destroy),
        });
        gRendererConstructor = Napi::Persistent(constructor);
        gRendererConstructor.SuppressDestruct();
    }

    static Napi::Object New(Napi::Env env,
                            const std::shared_ptr<NativeGpuContext>& context,
                            Napi::Object surface,
                            uint32_t width,
                            uint32_t height,
                            Napi::String presentMode,
                            Napi::String alphaMode) {
        return gRendererConstructor.New(
            {SharedExternal(env, context), surface,
             Napi::Number::New(env, width), Napi::Number::New(env, height),
             presentMode, alphaMode});
    }

    explicit Renderer(const Napi::CallbackInfo& info) : Napi::ObjectWrap<Renderer>(info) {
        context_ = *info[0].As<Napi::External<std::shared_ptr<NativeGpuContext>>>().Data();
        presentMode_ = kPresentModes.at(info[4].As<Napi::String>().Utf8Value());
        alphaMode_ = kAlphaModes.at(info[5].As<Napi::String>().Utf8Value());
        surface_ = CreateWindowSurface(
            info.Env(), context_->instance->Get(), info[1].As<Napi::Object>());
        if (surface_ == nullptr) {
            Napi::Error::New(info.Env(), "WebGPU surface creation failed")
                .ThrowAsJavaScriptException();
            return;
        }
        ConfigureInitialSurface(
            info.Env(), info[2].ToNumber().Uint32Value(), info[3].ToNumber().Uint32Value());
    }

    ~Renderer() override { DestroySurface(); }

  private:
    std::shared_ptr<NativeGpuContext> context_;
    WGPUSurface surface_ = nullptr;
    WGPUTextureFormat preferredFormat_ = WGPUTextureFormat_Undefined;
    WGPUPresentMode presentMode_ = WGPUPresentMode_Fifo;
    WGPUCompositeAlphaMode alphaMode_ = WGPUCompositeAlphaMode_Opaque;
    uint32_t width_ = 0;
    uint32_t height_ = 0;
    bool configured_ = false;
    bool alphaFallback_ = false;

    // surfaceGetCurrentTexture returns an owned reference; adopt it exactly once
    // so every success and failure path releases the acquisition through RAII.
    wgpu::Texture AcquireCurrentTexture(Napi::Env env) const {
        if (!configured_ || surface_ == nullptr) {
            Napi::Error::New(env, "WebGPU surface is not configured")
                .ThrowAsJavaScriptException();
            return {};
        }

        WGPUSurfaceTexture surfaceTexture = {};
        gProcs->surfaceGetCurrentTexture(surface_, &surfaceTexture);
        wgpu::Texture texture = wgpu::Texture::Acquire(surfaceTexture.texture);
        const bool succeeded =
            surfaceTexture.status == WGPUSurfaceGetCurrentTextureStatus_SuccessOptimal ||
            surfaceTexture.status == WGPUSurfaceGetCurrentTextureStatus_SuccessSuboptimal;
        if (!succeeded || !texture) {
            Napi::Error::New(
                env,
                std::string("WebGPU surface texture acquisition failed: ") +
                    SurfaceTextureStatusName(surfaceTexture.status))
                .ThrowAsJavaScriptException();
            return {};
        }

        return texture;
    }

    void ConfigureInitialSurface(Napi::Env env, uint32_t width, uint32_t height) {
        WGPUSurfaceCapabilities capabilities = {};
        gProcs->surfaceGetCapabilities(surface_, context_->adapter.Get(), &capabilities);
        bool alphaSupported = false;
        bool opaqueSupported = false;
        for (size_t index = 0; index < capabilities.alphaModeCount; ++index) {
            alphaSupported |= capabilities.alphaModes[index] == alphaMode_;
            opaqueSupported |= capabilities.alphaModes[index] == WGPUCompositeAlphaMode_Opaque;
        }
        if (!alphaSupported && alphaMode_ == WGPUCompositeAlphaMode_Premultiplied &&
            opaqueSupported) {
#if defined(__linux__)
            alphaMode_ = WGPUCompositeAlphaMode_Opaque;
            alphaFallback_ = true;
#endif
        }
        if ((!alphaSupported && !alphaFallback_) || capabilities.formatCount == 0) {
            gProcs->surfaceCapabilitiesFreeMembers(capabilities);
            Napi::Error::New(env, "requested WebGPU surface configuration is not supported")
                .ThrowAsJavaScriptException();
            return;
        }
        preferredFormat_ = capabilities.formats[0];
        for (size_t index = 0; index < capabilities.formatCount; ++index) {
            if (capabilities.formats[index] == WGPUTextureFormat_BGRA8Unorm) {
                preferredFormat_ = WGPUTextureFormat_BGRA8Unorm;
                break;
            }
        }
        gProcs->surfaceCapabilitiesFreeMembers(capabilities);
        ConfigureSurface(std::max(1u, width), std::max(1u, height));
    }

    void ConfigureSurface(uint32_t width, uint32_t height) {
        if (surface_ == nullptr || (configured_ && width == width_ && height == height_)) return;
        WGPUSurfaceConfiguration configuration = {};
        configuration.device = context_->device.Get();
        configuration.format = preferredFormat_;
        configuration.usage = WGPUTextureUsage_RenderAttachment;
        configuration.alphaMode = alphaMode_;
        configuration.width = width;
        configuration.height = height;
        configuration.presentMode = presentMode_;
        gProcs->surfaceConfigure(surface_, &configuration);
        width_ = width;
        height_ = height;
        configured_ = true;
    }

    void DestroySurface() {
        if (surface_ == nullptr) return;
        if (configured_) gProcs->surfaceUnconfigure(surface_);
        gProcs->surfaceRelease(surface_);
        surface_ = nullptr;
        configured_ = false;
        context_.reset();
    }

    Napi::Value GetPreferredFormat(const Napi::CallbackInfo& info) {
        wgpu::interop::GPUTextureFormat format;
        wgpu::binding::Converter converter(info.Env());
        return converter(format, static_cast<wgpu::TextureFormat>(preferredFormat_))
            ? wgpu::interop::ToJS(info.Env(), format)
            : info.Env().Null();
    }

    Napi::Value GetAlphaMode(const Napi::CallbackInfo& info) {
        return Napi::String::New(
            info.Env(),
            alphaMode_ == WGPUCompositeAlphaMode_Premultiplied
                ? "premultiplied"
                : "opaque");
    }

    Napi::Value GetCurrentTexture(const Napi::CallbackInfo& info) {
        wgpu::Texture texture = AcquireCurrentTexture(info.Env());
        if (!texture) return info.Env().Undefined();

        gProcs->deviceAddRef(context_->device.Get());
        return wgpu::interop::GPUTexture::Create<wgpu::binding::GPUTexture>(
            info.Env(), wgpu::Device::Acquire(context_->device.Get()), wgpu::TextureDescriptor(),
            std::move(texture));
    }

    Napi::Value GetCurrentTextureView(const Napi::CallbackInfo& info) {
        wgpu::Texture texture = AcquireCurrentTexture(info.Env());
        if (!texture) return info.Env().Undefined();

        const wgpu::TextureViewDescriptor descriptor = {};
        wgpu::TextureView view = texture.CreateView(&descriptor);
        return wgpu::interop::GPUTextureView::Create<wgpu::binding::GPUTextureView>(
            info.Env(), descriptor, std::move(view));
    }

    Napi::Value Swap(const Napi::CallbackInfo& info) {
        if (!configured_ || surface_ == nullptr) {
            Napi::Error::New(info.Env(), "WebGPU surface is not configured")
                .ThrowAsJavaScriptException();
            return info.Env().Undefined();
        }
        gProcs->surfacePresent(surface_);
        return info.Env().Undefined();
    }

    Napi::Value Resize(const Napi::CallbackInfo& info) {
        if (info.Length() != 2) {
            Napi::TypeError::New(info.Env(), "resize expects width and height")
                .ThrowAsJavaScriptException();
            return info.Env().Undefined();
        }
        const auto width = DecodeSurfaceDimension(info.Env(), info[0], "width");
        const auto height = DecodeSurfaceDimension(info.Env(), info[1], "height");
        if (!width.has_value() || !height.has_value()) return info.Env().Undefined();
        ConfigureSurface(*width, *height);
        return info.Env().Undefined();
    }

    Napi::Value Destroy(const Napi::CallbackInfo& info) {
        DestroySurface();
        return info.Env().Undefined();
    }
};

Napi::Value CreateWindowContext(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() != 1 || !info[0].IsObject()) {
        Napi::TypeError::New(env, "createWindowContext expects one options object")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }
    Napi::Object options = info[0].As<Napi::Object>();
    if (!options.Get("surface").IsObject()) {
        Napi::TypeError::New(env, "surface must be a native surface descriptor")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }
    const auto width = DecodeSurfaceDimension(env, options.Get("width"), "width");
    const auto height = DecodeSurfaceDimension(env, options.Get("height"), "height");
    if (!width.has_value() || !height.has_value()) return env.Undefined();
    const std::string presentMode = options.Has("presentMode")
        ? options.Get("presentMode").ToString().Utf8Value() : "fifo";
    const std::string alphaMode = options.Has("alphaMode")
        ? options.Get("alphaMode").ToString().Utf8Value() : "opaque";
    if (!kPresentModes.contains(presentMode)) {
        Napi::TypeError::New(env, "presentMode has an invalid value").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    if (!kAlphaModes.contains(alphaMode)) {
        Napi::TypeError::New(env, "alphaMode has an invalid value").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto flags = ParseFlags(env, options.Get("flags"));
    if (!flags.has_value()) return env.Undefined();
    auto context = CreateNativeContext(env, std::move(*flags));
    if (context == nullptr) return env.Undefined();
    auto adapter = wgpu::interop::GPUAdapter::Create<wgpu::binding::GPUAdapter>(
        env, context->adapter, context->flags, context->async);
    auto device = wgpu::interop::GPUDevice::Bind(
        env, std::make_unique<wgpu::binding::GPUDevice>(
            env, wgpu::DeviceDescriptor(), context->device, *context->lostPromise, context->async));
    Napi::Object renderer = Renderer::New(
        env, context, options.Get("surface").As<Napi::Object>(),
        *width, *height,
        Napi::String::New(env, presentMode), Napi::String::New(env, alphaMode));

    Napi::Object adapterObject = adapter;
    Napi::Object deviceObject = device;
    adapterObject.Set("_nativeContext", SharedExternal(env, context));
    deviceObject.Set("_nativeContext", SharedExternal(env, context));
    Napi::Object result = Napi::Object::New(env);
    result.Set("adapter", adapterObject);
    result.Set("device", deviceObject);
    result.Set("renderer", renderer);
    result.Set("requestedAlphaMode", alphaMode);
    result.Set("alphaMode", renderer.Get("getAlphaMode").As<Napi::Function>().Call(renderer, {}).ToString());
    result.Set("_nativeContext", SharedExternal(env, context));
    return result;
}

}  // namespace

NAPI_MODULE_EXPORT Napi::Object Initialize(Napi::Env env, Napi::Object exports) {
    gProcs = &dawn::native::GetProcs();
    dawnProcSetProcs(gProcs);
    exports.Set("globals", wgpu::interop::Initialize(env));
    Renderer::Init(env);
    exports.Set("createWindowContext", Napi::Function::New(env, CreateWindowContext));
    return exports;
}

NODE_API_MODULE(addon, Initialize)
