export function stringify(value: any): string {
  let result = "";

  if (value === undefined)
    return 'undefined';

  if (value === null)
    return 'null';

  if (typeof value === 'number' || typeof value === 'string')
    return <string>value;

  if (value instanceof RegExp || typeof value === 'boolean')
    return value.toString();

  if (Array.isArray(value)) {
    result += '[';
    for (let i = 0; i < value.length; i++) {
      result += stringify(value[i]);
      if (i < value.length - 1)
        result += ',';
    }
    result += ']';
    return result;
  }

  if (typeof value === "object") {
    result += '{';
    for (let prop in value) {
      result += prop + ':';
      result += stringify(value[prop]);
      result += ','
    }

    result = result.length > 1 ? result.slice(0, result.length - 1) : result;
    result += '}';
    return result;
  }

  return result;
}