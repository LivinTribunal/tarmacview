import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  addStudioLights,
  centerAndScaleModel,
  computeFitCamera,
  disposeScene,
} from "./threeSceneSetup";

// thumbnail cache - keyed by model url
const thumbnailCache = new Map<string, string>();

/** render a model to a png data url for thumbnail generation. */
export async function renderToImage(
  modelUrl: string,
  size = 256,
): Promise<string> {
  const cached = thumbnailCache.get(modelUrl);
  if (cached) return cached;

  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
  });
  renderer.setSize(size, size);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);

  addStudioLights(scene);

  const loader = new GLTFLoader();

  return new Promise((resolve, reject) => {
    loader.load(
      modelUrl,
      (gltf) => {
        const model = gltf.scene;
        centerAndScaleModel(model);
        scene.add(model);

        const fit = computeFitCamera(model, camera);
        camera.position.copy(fit.position);
        camera.lookAt(fit.target);

        renderer.render(scene, camera);
        const dataUrl = renderer.domElement.toDataURL("image/png");
        thumbnailCache.set(modelUrl, dataUrl);

        disposeScene(scene);
        renderer.dispose();

        resolve(dataUrl);
      },
      undefined,
      (err) => {
        renderer.dispose();
        reject(err);
      },
    );
  });
}
