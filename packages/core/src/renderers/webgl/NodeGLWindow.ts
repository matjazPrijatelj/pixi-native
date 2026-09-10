import { NodeGlfwWindow } from "../glfw/NodeGlfwWindow.ts";

export {
  type GlfwWindowKeyEvent as GlWindowKeyEvent,
  type GlfwWindowMouseEvent as GlWindowMouseEvent,
} from "../glfw/NodeGlfwWindow.ts";

/** Backward-compatible name for the shared GLFW window adapter. */
export class NodeGLWindow extends NodeGlfwWindow {}
