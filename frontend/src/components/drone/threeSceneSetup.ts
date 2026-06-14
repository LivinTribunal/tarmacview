import * as THREE from "three";

// three-light studio rig shared by the live viewer and the thumbnail renderer.
// colors are warm key / cool fill so the model reads well on any background.
const AMBIENT_LIGHT_COLOR = 0xffffff;
const AMBIENT_LIGHT_INTENSITY = 0.6;
const KEY_LIGHT_COLOR = 0xfff5e0;
const KEY_LIGHT_INTENSITY = 1.2;
const FILL_LIGHT_COLOR = 0xc0e0ff;
const FILL_LIGHT_INTENSITY = 0.4;

/** add the shared 3-light studio rig to a scene. */
export function addStudioLights(scene: THREE.Scene): void {
  scene.add(new THREE.AmbientLight(AMBIENT_LIGHT_COLOR, AMBIENT_LIGHT_INTENSITY));
  const keyLight = new THREE.DirectionalLight(KEY_LIGHT_COLOR, KEY_LIGHT_INTENSITY);
  keyLight.position.set(3, 4, 2);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(FILL_LIGHT_COLOR, FILL_LIGHT_INTENSITY);
  fillLight.position.set(-2, 1, -2);
  scene.add(fillLight);
}

/** center the model at the origin and scale it to fit a 2-unit cube. */
export function centerAndScaleModel(model: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const scale = maxDim > 0 ? 2 / maxDim : 1;
  model.scale.setScalar(scale);
  model.position.sub(center.multiplyScalar(scale));
}

export interface FitCameraResult {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

/** compute the camera position and target that frames the model. */
export function computeFitCamera(
  model: THREE.Object3D,
  camera: THREE.PerspectiveCamera,
): FitCameraResult {
  const fitBox = new THREE.Box3().setFromObject(model);
  const fitSize = fitBox.getSize(new THREE.Vector3());
  const fitMax = Math.max(fitSize.x, fitSize.y, fitSize.z);
  const fov = camera.fov * (Math.PI / 180);
  const dist = (fitMax / (2 * Math.tan(fov / 2))) * 1.4;
  const fitCenter = fitBox.getCenter(new THREE.Vector3());
  const position = new THREE.Vector3(
    fitCenter.x + dist * 0.5,
    fitCenter.y + dist * 0.4,
    fitCenter.z + dist,
  );
  return { position, target: fitCenter };
}

/** dispose every geometry and material reachable from a scene. */
export function disposeScene(scene: THREE.Scene): void {
  scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry?.dispose();
      if (Array.isArray(obj.material)) {
        obj.material.forEach((m: THREE.Material) => m.dispose());
      } else {
        obj.material?.dispose();
      }
    }
  });
}
