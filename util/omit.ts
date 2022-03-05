import { cleanPropPath } from "./clean-prop-path";

export function omit(obj: { [key: string]: any; }, props: string[]): any {
  for (let i = 0; i < props.length; i++) {
    let path = cleanPropPath(props[i]).split('.');

    if (path.length === 1) {
      delete obj[props[i]];
      continue;
    }

    let temp = obj;
    for (let j = 0; j < path.length; j++) {
      temp = temp[path[j]];

      if (!temp)
        break;
        
      if (j === path.length - 2) {
        delete temp[path[j + 1]];
        break;
      }
    }
  }

  return obj;
}