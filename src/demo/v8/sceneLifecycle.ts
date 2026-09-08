import { Container, type DestroyOptions } from "pixi.js";

export interface DisposableDemoScene extends Container {
  dispose?(): void;
  /** Scenes with live child-list changes must stay on Pixi's direct path. */
  useRenderGroup?: boolean;
}

const SCENE_DESTROY_OPTIONS: DestroyOptions = {
  children: true,
  context: true,
  style: true,
};

/** Releases one scene and all resources it owns, while preserving shared textures. */
export function disposeDemoScene(scene: DisposableDemoScene): void {
  if (scene.destroyed) return;
  scene.parent?.removeChild(scene);
  // Pixi's batcher keeps per-InstructionSet buffers for the renderer lifetime.
  // Return the RenderGroup to Pixi's pool so later scenes reuse those buffers.
  scene.disableRenderGroup();
  scene.dispose?.();
  scene.destroy(SCENE_DESTROY_OPTIONS);
}
