export interface PathPart {
  text: string;
  regex?: RegExp;
  isParam?: boolean;
  isRest?: boolean;
  isOptional?: boolean;
}

export class PathPattern {
  private _parts: PathPart[];
  private _pattern: string;
  private _hasRest = false;
  private _hasOptionalRest = false;
  private _optionalsCount = 0;
  private _values: { [key: string]: string | string[] } = {};

  constructor(pattern: string) {
    this._pattern = PathPattern.Clean(pattern);
    this.init();
  }

  static Clean(path: string) {
    if (!path)
      return "";

    path = path.trim()
      .replace(/^\//g, "")
      .replace(/\/$/g, "")
      .replace(/\/{2,}/g, "/")
      .replace(/(\w+)\/\.+/g, "$1");

    return path;
  }

  private init() {
    this._parts = [];
    this._hasRest = false;
    this._hasOptionalRest = false;
    this._optionalsCount = 0;
    this._values = {};
    let parts = this._pattern.split('/');

    for (let part of parts) {  
      let pathPart = <PathPart>{ text: part };

      if (part.charAt(0) === '*') {
        pathPart.text = "*";
        if (this._optionalsCount > 0) throw 'invalidPathPattern';
        pathPart.isParam = true;
        pathPart.isRest = true;
        this._parts.push(pathPart);
        this._hasRest = true;
        this._hasOptionalRest = pathPart.isOptional = part.charAt(1) === '?';
        continue;
      }

      if (this._hasRest) throw 'invalidPathPattern';

      if (part.charAt(0) !== '{') {
        if (this._optionalsCount > 0) throw 'invalidPathPattern';
        this._parts.push(pathPart);
        continue;
      };
      
      pathPart.isParam = true;
      pathPart.isOptional = part.charAt(part.length - 1) === '?';
      pathPart.isOptional && this._optionalsCount++;

      let block = part.slice(1, pathPart.isOptional ? -2 : -1).split(':');
      pathPart.text = block[0]
      if (block.length > 1) pathPart.regex = new RegExp(block[1], block[2]);
      this._parts.push(pathPart);
    }
  }

  get params(): { [key: string]: string | string[] } { return Object.assign({}, this._values); }
  get pattern(): string { return this._pattern; }

  set pattern(value: string) {
    this._pattern = PathPattern.Clean(value);
    this.init();
  }

  match(path: string) {
    path = PathPattern.Clean(path);
    let pathParts = path.split('/');

    if (this._hasRest) {
      if (this._hasOptionalRest) {
        if (pathParts.length < this._parts.length - 1) return false;
      } else if (pathParts.length < this._parts.length) return false;

    } else if (this._optionalsCount > 0) {
      if (this._parts.length < pathParts.length) return false;
      else if (this._parts.length - this._optionalsCount > pathParts.length) return false;

    } else if (pathParts.length !== this._parts.length) return false;

    for (let i = 0; i < this._parts.length; i++) {
      let part = this._parts[i];

      if (!part.isParam) {
        if (part.text.toLowerCase() !== pathParts[i].toLowerCase()) return false;

      } else {
        if (part.isRest) {
          this._values[part.text] = pathParts.slice(i) || null;

        } else {
          let value = pathParts[i] || null;
          if (value && part.regex)
            if (!part.regex.test(value)) return false;
          this._values[part.text] = value;
        }
      }
    }

    return true;
  }

  pathFromParams(params: { [key: string]: string | string[] }): string {
    let path = "/";

    for (let part of this._parts) {
      if (!part.isParam) {
        path += part.text + '/';
      } else {
        if (part.isRest) {
          let value = params[part.text];
          if (!part.isOptional) {
            if (!value) throw 'rest is required';
            else if (Array.isArray(value) && value.length === 0) throw 'rest is required';
          }
          let rest = Array.isArray(value) ? value.join('/') : value;
          path += rest || '';
          
        } else {
          let value = params[part.text];

          if (Array.isArray(value)) throw 'param could not be assigned to array value';
          
          if (!value && !part.isOptional) throw `${part.text} param is required`;

          if (value && part.regex)
            if (!part.regex.test(value)) throw `invalid param value ${value}`;
          
            path += value + '/' || '';
        }
      }
    }

    return PathPattern.Clean(path);
  }
}