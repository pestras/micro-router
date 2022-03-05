export function strSplice(src: string, start: number, deleteCount: number = src.length, insertion: string = ""): string {
  let end = (start + deleteCount) > src.length ? src.length : start + deleteCount;
  return src.slice(0, start) + insertion + src.slice(end, src.length);
}