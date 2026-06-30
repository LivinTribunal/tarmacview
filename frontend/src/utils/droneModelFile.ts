/** true when a custom drone model upload is an accepted 3d format (.glb/.gltf). */
export function isValidModelFile(file: File): boolean {
  const ext = file.name.toLowerCase().split(".").pop();
  return ext === "glb" || ext === "gltf";
}
