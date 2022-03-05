export function parse(str: string): any {
  var result: any;
  var type: string;

  if (str === 'null') return null;
  if (str === 'undefined') return undefined;
  if (!isNaN(Number(str))) return Number(str);
  if (str === 'true') return true;
  if (str === 'false') return false;

  if (str.charAt(0) === '/' && /\/[g|i|s|m|u]*$/.test(str)) {
    let parts = decodeURI(str).split('/');
    let flags = parts.pop();
    str = parts.join('/').replace(/^\/|\/$/g, '');
    return new RegExp(str, flags);
  }

  if (str.charAt(0) === '{') {
    result = {};
    type = 'object';
  } else if (str.charAt(0) === '[') {
    result = [];
    type = 'array'
  } else return decodeURI(str);

  str = decodeURI(str).slice(1, -1);

  let temp: any = { value: '', prop: '' }
  let context: string = type === 'array' ? 'value' : 'prop';
  let level: number = 0;

  for (let i = 0; i < str.length; i++) {
    if (str.charAt(i) === ':' && level === 0 && type === 'object') {
      context = 'value';
      continue;
    } else if (str.charAt(i) === '[') {
      level++;
    } else if (str.charAt(i) === ']') {
      level--;
    } if (str.charAt(i) === '{') {
      level++;
    } else if (str.charAt(i) === '}') {
      level--;
    } else if (str.charAt(i) === ',' && level === 0) {
      if (type === 'array') {
        result.push(temp.value.trim());
      } else {
        result[temp.prop.trim()] = temp.value.trim();
        context = 'prop';
      }

      temp.prop = '';
      temp.value = '';
      continue;
    }

    temp[context] += str.charAt(i);

    if (i === str.length - 1) {
      if (type === 'array') result.push(temp.value.trim());
      else result[temp.prop.trim()] = temp.value.trim();
    }
  }

  if (type === 'array')
    result = result.map((prop: any) => parse(prop));
  else
    for (let prop in result)
      result[prop] = parse(result[prop]);

  return result;
}