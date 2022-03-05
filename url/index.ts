import { URL as RootURL } from 'url';
import { parse } from '../util/parse';
import { stringify } from '../util/stringify';
import { strSplice } from '../util/str-splice';
import { PathPattern } from './path-pattern';

export class URL extends RootURL {
  query: any;
  private _pathPattern: PathPattern;

  constructor(href: string, base?: string | RootURL) {
    super(href, base);
    this.query = this.search ? URL.QueryToObject(this.search.slice(1)) : {};
  }

  static QueryToObject(query: string): any {
    query = decodeURI(query);

    let result: any = {};
    let parts: any[] = query.split('&');

    for (let i = 0; i < parts.length; i++) {
      let part: any = parts[i];
      let pair: any[] = part.split('=');

      result[pair[0]] = pair[1] ? parse(pair[1]) : null;
    }

    return result;
  }

  static ObjectToQuery(obj: { [key: string]: any }, encode?: boolean): string {
    let result = "";
  
    if (!obj || !Object.keys(obj).length)
      return result;
  
    for (let prop in obj)
      result += '&' + prop + '=' + stringify(obj[prop]);
  
    return encode ? encodeURI(result.slice(1)) : result.slice(1);
  }

  static Clean(path: string) {
    if (!path)

      return "";

    path = path.trim()
      .replace(/^\/|\/$/g, "")
      .replace(/:\/\//, '%')
      .replace(/\/{2,}/g, "/")
      .replace(/(\w+)\/\.+/g, "$1")
      .replace('%', '://');

    return path;
  }

  static From(origin: string, pathname?: { pattern: string, params: { [key: string]: string } } | string, searchObj?: any, hash?: string): URL {
    let url = new URL(origin);
    if (pathname) {
      if (typeof pathname === 'string')
        url.setPathname(pathname);
      else {
        let pathPattern = new PathPattern(pathname.pattern);
        let path = pathPattern.pathFromParams(pathname.params);

        if (pathPattern.match(path)) {
          url.setPathname(path);
          url._pathPattern = pathPattern;
        }
      }
    }

    if (searchObj) {
      url.search = URL.ObjectToQuery(searchObj);
    }

    if (hash)
      url.hash = hash;

    return url;
  }

  get pathPattern(): string {
    return this._pathPattern ? this._pathPattern.pattern : null;
  }

  set pathPattern(value: string) {
    let pp = new PathPattern(value);
    if (!pp.match(super.pathname))
      throw 'invalid existing pathname';

    this._pathPattern = pp;
  }

  get params(): { [key: string]: string | string[] } {
    return this._pathPattern ? this._pathPattern.params : {};
  }

  set params(value: { [key: string]: string | string[] }) {
    if (this._pathPattern) {
      let params = this.params;
      Object.assign(params, value);
      this.pathname = this._pathPattern.pathFromParams(value);
    }
  }

  setPathname(value: string) {
    value = PathPattern.Clean(value);
    
    if (this._pathPattern) {
      if (this._pathPattern.match(value))
        this.pathname = '/' + value;
    } else {
      this.pathname = '/' + value;
    }
  }

  getPathname(): string {
    return this.pathname;
  }

  setPathParam(key: string, value: string) {
    if (this._pathPattern) {
      let params = this.params;
      params[key] = value;
      this.params = params;
    }
  }

  isSecure(): boolean {
    return this.protocol.charAt(this.protocol.length - 2) === 's';
  }

  secure(enable: boolean = true) {
    if (enable && !this.isSecure())
      this.protocol = strSplice(this.protocol, this.protocol.length - 1, 0, 's');
    else if (!enable && this.isSecure())
      this.protocol = strSplice(this.protocol, this.protocol.length - 2, 1);
  }
}