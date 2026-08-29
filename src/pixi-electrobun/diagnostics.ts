type AnyRecord = Record<string, any>;

function finite(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function logPipelineDescriptor(descriptor: AnyRecord): void {
    const buffers = descriptor?.vertex?.buffers ?? [];
    for (const [index, buffer] of buffers.entries()) {
        if (!buffer) continue;
        const summary = {
            arrayStride: buffer.arrayStride,
            stepMode: buffer.stepMode,
            attributes: (buffer.attributes ?? []).map((attribute: AnyRecord) => ({
                format: attribute.format,
                offset: attribute.offset,
                shaderLocation: attribute.shaderLocation
            }))
        };
        console.log("VERTEX BUFFER", index, summary);
        if (!finite(buffer.arrayStride) || buffer.arrayStride < 0 || buffer.arrayStride % 4 !== 0) {
            throw new Error("Invalid Pixi vertex arrayStride: " + String(buffer.arrayStride));
        }
        for (const attribute of buffer.attributes ?? []) {
            if (!finite(attribute.offset) || attribute.offset < 0 || attribute.offset % 4 !== 0) {
                throw new Error("Invalid Pixi vertex attribute offset: " + String(attribute.offset));
            }
        }
    }
}

const NUMERIC_VERTEX_FORMATS: Record<string, number> = {
    uint8x2: 0x02,
    uint8x4: 0x03,
    sint8x2: 0x05,
    sint8x4: 0x06,
    unorm8x2: 0x08,
    unorm8x4: 0x09,
    snorm8x2: 0x0b,
    snorm8x4: 0x0c,
    uint16x2: 0x0e,
    uint16x4: 0x0f,
    sint16x2: 0x11,
    sint16x4: 0x12,
    unorm16x2: 0x14,
    unorm16x4: 0x15,
    snorm16x2: 0x17,
    snorm16x4: 0x18,
    float16x2: 0x1a,
    float16x4: 0x1b
};

function normalizeVertexFormats(descriptor: AnyRecord): AnyRecord {
    const vertex = descriptor?.vertex;
    if (!vertex?.buffers) return descriptor;
    return {
        ...descriptor,
        vertex: {
            ...vertex,
            buffers: vertex.buffers.map((buffer: AnyRecord) => buffer ? {
                ...buffer,
                attributes: (buffer.attributes ?? []).map((attribute: AnyRecord) => {
                    const format = attribute.format;
                    const numericFormat = typeof format === "string" ? NUMERIC_VERTEX_FORMATS[format] : undefined;
                    return numericFormat === undefined ? attribute : { ...attribute, format: numericFormat };
                })
            } : buffer)
        }
    };
}

function validateClearValue(clearValue: AnyRecord, location: string): void {
    for (const [key, value] of Object.entries(clearValue ?? {})) {
        if (!finite(value)) throw new Error("Invalid " + location + "." + key + ": " + String(value));
    }
}

export function installWebGPUDiagnostics(device: any): void {
    if (device.__pixiElectrobunDiagnostics) return;
    const originalCreateRenderPipeline = device.createRenderPipeline.bind(device);
    device.createRenderPipeline = (descriptor: AnyRecord) => {
        logPipelineDescriptor(descriptor);
        const normalizedDescriptor = normalizeVertexFormats(descriptor);
        return originalCreateRenderPipeline(normalizedDescriptor);
    };
    const originalCreateCommandEncoder = device.createCommandEncoder.bind(device);
    device.createCommandEncoder = (...args: any[]) => {
        const encoder = originalCreateCommandEncoder(...args);
        const originalBeginRenderPass = encoder.beginRenderPass.bind(encoder);
        encoder.beginRenderPass = (descriptor: AnyRecord) => {
            console.log("PIXİ_CLEAR_DESCRIPTOR", descriptor);
            const normalized = { ...descriptor, colorAttachments: (descriptor?.colorAttachments ?? []).map((attachment: AnyRecord) => {
                validateClearValue(attachment?.clearValue, "colorAttachments.clearValue");
                const clearValue = attachment?.clearValue;
                const normalizedClearValue = Array.isArray(clearValue) && clearValue.length >= 4
                    ? { r: clearValue[0], g: clearValue[1], b: clearValue[2], a: clearValue[3] }
                    : clearValue;
                return { ...attachment, clearValue: normalizedClearValue };
            }) };
            validateClearValue(descriptor?.depthStencilAttachment?.depthClearValue, "depthStencilAttachment.depthClearValue");
            validateClearValue(descriptor?.depthStencilAttachment?.stencilClearValue, "depthStencilAttachment.stencilClearValue");
            return originalBeginRenderPass(normalized);
        };
        return encoder;
    };
    device.__pixiElectrobunDiagnostics = true;
}
