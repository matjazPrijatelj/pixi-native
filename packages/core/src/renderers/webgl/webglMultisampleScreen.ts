import type { AntialiasSamples } from "../../runtime/nativeTypes.ts";

export interface WebGlMultisampleScreen {
    readonly sampleCount: AntialiasSamples;
    resize(width: number, height: number): void;
    resolve(): void;
    destroy(): void;
}

interface MultisampleAttachments {
    readonly framebuffer: WebGLFramebuffer;
    readonly color: WebGLRenderbuffer;
    readonly depthStencil: WebGLRenderbuffer;
}

/** Makes a multisampled framebuffer appear as WebGL's default screen target. */
export function installWebGlMultisampleScreen(
    gl: WebGL2RenderingContext,
    width: number,
    height: number,
    requestedSampleCount: AntialiasSamples,
): WebGlMultisampleScreen {
    const sampleCount = selectSupportedSampleCount(gl, requestedSampleCount);
    if (sampleCount === 0) {
        return {
            sampleCount,
            resize: () => undefined,
            resolve: () => undefined,
            destroy: () => undefined,
        };
    }

    const bindFramebuffer = gl.bindFramebuffer.bind(gl);
    const getParameter = gl.getParameter.bind(gl);
    const getContextAttributes = gl.getContextAttributes.bind(gl);
    let attachments = createAttachments(width, height);
    let screenWidth = normalizeSize(width);
    let screenHeight = normalizeSize(height);
    let destroyed = false;

    const mutableGl = gl as WebGL2RenderingContext & {
        bindFramebuffer: WebGL2RenderingContext["bindFramebuffer"];
        getParameter: WebGL2RenderingContext["getParameter"];
        getContextAttributes: WebGL2RenderingContext["getContextAttributes"];
    };

    mutableGl.bindFramebuffer = (
        target: GLenum,
        framebuffer: WebGLFramebuffer | null,
    ): void => {
        bindFramebuffer(
            target,
            framebuffer === null ? attachments.framebuffer : framebuffer,
        );
    };
    mutableGl.getParameter = (parameter: GLenum): unknown => {
        const value = getParameter(parameter);
        if (
            (parameter === gl.FRAMEBUFFER_BINDING ||
                parameter === gl.DRAW_FRAMEBUFFER_BINDING ||
                parameter === gl.READ_FRAMEBUFFER_BINDING) &&
            value === attachments.framebuffer
        ) {
            return null;
        }
        return value;
    };
    mutableGl.getContextAttributes = (): WebGLContextAttributes | null => {
        const attributes = getContextAttributes();
        return attributes ? { ...attributes, antialias: true } : null;
    };

    // Pixi keeps default-framebuffer semantics while rendering into MSAA storage.
    mutableGl.bindFramebuffer(gl.FRAMEBUFFER, null);

    function createAttachments(
        requestedWidth: number,
        requestedHeight: number,
    ): MultisampleAttachments {
        const attachmentWidth = normalizeSize(requestedWidth);
        const attachmentHeight = normalizeSize(requestedHeight);
        const previousDraw = getParameter(
            gl.DRAW_FRAMEBUFFER_BINDING,
        ) as WebGLFramebuffer | null;
        const previousRead = getParameter(
            gl.READ_FRAMEBUFFER_BINDING,
        ) as WebGLFramebuffer | null;
        const previousRenderbuffer = getParameter(
            gl.RENDERBUFFER_BINDING,
        ) as WebGLRenderbuffer | null;
        const framebuffer = gl.createFramebuffer();
        const color = gl.createRenderbuffer();
        const depthStencil = gl.createRenderbuffer();
        if (!framebuffer || !color || !depthStencil) {
            if (framebuffer) gl.deleteFramebuffer(framebuffer);
            if (color) gl.deleteRenderbuffer(color);
            if (depthStencil) gl.deleteRenderbuffer(depthStencil);
            throw new Error(
                "WebGL could not allocate the multisample screen framebuffer",
            );
        }

        try {
            bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
            gl.bindRenderbuffer(gl.RENDERBUFFER, color);
            gl.renderbufferStorageMultisample(
                gl.RENDERBUFFER,
                sampleCount,
                gl.RGBA8,
                attachmentWidth,
                attachmentHeight,
            );
            gl.framebufferRenderbuffer(
                gl.FRAMEBUFFER,
                gl.COLOR_ATTACHMENT0,
                gl.RENDERBUFFER,
                color,
            );

            gl.bindRenderbuffer(gl.RENDERBUFFER, depthStencil);
            gl.renderbufferStorageMultisample(
                gl.RENDERBUFFER,
                sampleCount,
                gl.DEPTH24_STENCIL8,
                attachmentWidth,
                attachmentHeight,
            );
            gl.framebufferRenderbuffer(
                gl.FRAMEBUFFER,
                gl.DEPTH_STENCIL_ATTACHMENT,
                gl.RENDERBUFFER,
                depthStencil,
            );

            const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
            if (status !== gl.FRAMEBUFFER_COMPLETE) {
                throw new Error(
                    `WebGL multisample screen framebuffer is incomplete (0x${status.toString(16)})`,
                );
            }
        } catch (error) {
            gl.deleteFramebuffer(framebuffer);
            gl.deleteRenderbuffer(color);
            gl.deleteRenderbuffer(depthStencil);
            throw error;
        } finally {
            gl.bindRenderbuffer(gl.RENDERBUFFER, previousRenderbuffer);
            bindFramebuffer(gl.DRAW_FRAMEBUFFER, previousDraw);
            bindFramebuffer(gl.READ_FRAMEBUFFER, previousRead);
        }

        return { framebuffer, color, depthStencil };
    }

    return {
        sampleCount,
        resize(nextWidth: number, nextHeight: number): void {
            if (destroyed) return;
            const normalizedWidth = normalizeSize(nextWidth);
            const normalizedHeight = normalizeSize(nextHeight);
            if (
                normalizedWidth === screenWidth &&
                normalizedHeight === screenHeight
            ) {
                return;
            }

            const previous = attachments;
            const next = createAttachments(normalizedWidth, normalizedHeight);
            const previousDraw = getParameter(gl.DRAW_FRAMEBUFFER_BINDING);
            const previousRead = getParameter(gl.READ_FRAMEBUFFER_BINDING);
            attachments = next;
            screenWidth = normalizedWidth;
            screenHeight = normalizedHeight;

            bindFramebuffer(
                gl.DRAW_FRAMEBUFFER,
                previousDraw === previous.framebuffer
                    ? next.framebuffer
                    : (previousDraw as WebGLFramebuffer | null),
            );
            bindFramebuffer(
                gl.READ_FRAMEBUFFER,
                previousRead === previous.framebuffer
                    ? next.framebuffer
                    : (previousRead as WebGLFramebuffer | null),
            );
            gl.deleteFramebuffer(previous.framebuffer);
            gl.deleteRenderbuffer(previous.color);
            gl.deleteRenderbuffer(previous.depthStencil);
        },

        resolve(): void {
            if (destroyed) return;
            const previousDraw = getParameter(
                gl.DRAW_FRAMEBUFFER_BINDING,
            ) as WebGLFramebuffer | null;
            const previousRead = getParameter(
                gl.READ_FRAMEBUFFER_BINDING,
            ) as WebGLFramebuffer | null;
            bindFramebuffer(gl.READ_FRAMEBUFFER, attachments.framebuffer);
            bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
            gl.blitFramebuffer(
                0,
                0,
                screenWidth,
                screenHeight,
                0,
                0,
                screenWidth,
                screenHeight,
                gl.COLOR_BUFFER_BIT,
                gl.NEAREST,
            );
            bindFramebuffer(gl.DRAW_FRAMEBUFFER, previousDraw);
            bindFramebuffer(gl.READ_FRAMEBUFFER, previousRead);
        },

        destroy(): void {
            if (destroyed) return;
            destroyed = true;
            bindFramebuffer(gl.FRAMEBUFFER, null);
            mutableGl.bindFramebuffer = bindFramebuffer;
            mutableGl.getParameter = getParameter;
            mutableGl.getContextAttributes = getContextAttributes;
            gl.deleteFramebuffer(attachments.framebuffer);
            gl.deleteRenderbuffer(attachments.color);
            gl.deleteRenderbuffer(attachments.depthStencil);
        },
    };
}

function selectSupportedSampleCount(
    gl: WebGL2RenderingContext,
    requestedSampleCount: AntialiasSamples,
): AntialiasSamples {
    if (requestedSampleCount === 0) return 0;

    const colorSamples = new Set<number>(
        gl.getInternalformatParameter(gl.RENDERBUFFER, gl.RGBA8, gl.SAMPLES),
    );
    const depthStencilSamples = new Set<number>(
        gl.getInternalformatParameter(
            gl.RENDERBUFFER,
            gl.DEPTH24_STENCIL8,
            gl.SAMPLES,
        ),
    );
    const supportedSamples = [8, 4, 2].filter(
        (samples) =>
            samples <= requestedSampleCount &&
            colorSamples.has(samples) &&
            depthStencilSamples.has(samples),
    ) as AntialiasSamples[];
    return supportedSamples[0] ?? 0;
}

function normalizeSize(value: number): number {
    return Math.max(1, Math.floor(value));
}
