export function cleanPropPath(path: string = ""): string {
  return path
    .replace(/\[|\]+/g, ".")
    .replace(/^\.|\.$/g, "")
    .replace(/\.{2,}/g, ".");
}