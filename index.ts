import * as http from 'http';
import { MicroPlugin, Micro } from '@pestras/micro';
import { IncomingMessage, ServerResponse, IncomingHttpHeaders } from 'http';
import { URL } from '@pestras/toolbox/url';
import { PathPattern } from '@pestras/toolbox/url/path-pattern';
import { CODES } from '@pestras/toolbox/fetch/codes';
import { statSync, createReadStream } from 'fs';

export { CODES };

export type CORS = IncomingHttpHeaders & { 'response-code'?: string };

export type HttpMethod = 'HEAD' | 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface CookieOptions {
  Expires: string;
  "Max-Age": string;
  Secure: boolean;
  HttpOnly: boolean;
  Domain: string;
  Path: string;
  SameSite: "Strict" | "Lax" | "None";
}

export interface RouterConfig {
  version?: string;
  port?: number;
  host?: string;
  kebabCase?: boolean;
  ignoredRoutes?: [string, string][];
  cors?: CORS;
}

export interface RouterEvents {
  onListening?: () => void;
  onRequest?: (req: Request, res: Response) => void;
  on404?: (req: Request, res: Response) => void;
  onRouteError?: (req: Request, res: Response, err: any) => void;
}

const DEFAULT_CORS: IncomingHttpHeaders & { 'response-code'?: string } = {
  'access-control-allow-methods': "GET,HEAD,OPTIONS,PUT,PATCH,POST,DELETE",
  'access-control-allow-origin': "*",
  'access-control-allow-headers': "*",
  'Access-Control-Allow-Credentials': 'false',
  'response-code': '204'
}

/** Route Config interface */
export interface RouteConfig {
  name?: string;
  path?: string;
  method?: HttpMethod;
  /** default: application/json; charset=utf-8 */
  accepts?: string;
  hooks?: string[];
  bodyQuota?: number;
  processBody?: boolean;
  queryLength?: number;
  timeout?: number;
  cors?: CORS;
}

interface RouteFullConfig extends RouteConfig {
  key?: string;
  service?: any;
};

/**
 * Routes repo interface
 */
export interface Routes {
  GET?: { [key: string]: RouteFullConfig };
  HEAD?: { [key: string]: RouteFullConfig };
  POST?: { [key: string]: RouteFullConfig };
  PUT?: { [key: string]: RouteFullConfig };
  PATCH?: { [key: string]: RouteFullConfig };
  DELETE?: { [key: string]: RouteFullConfig };
}

/**
 * Routes repo object that will hold all defined routes
 */
let serviceRoutes: Routes = {};
let serviceRoutesRepo: RouteFullConfig[] = [];

/**
 * Route decorator
 * accepts route configuration
 * @param config 
 */
export function ROUTE(config: RouteConfig = {}) {
  return (target: any, key: string) => {
    serviceRoutesRepo.push({ key, ...config, service: target.constructor });
  }
}

/**
 * Request wrapper for original node incoming message
 * include url and body parsing
 */
export class Request<T = any, U = any> {
  private _body: T = null;
  private _params: { [key: string]: string | string[] } = null;
  readonly url: URL;
  readonly method: HttpMethod;
  readonly locals: { [key: string]: any } = {};
  readonly cookies: { [key: string]: string } = {};
  auth?: U;

  constructor(public readonly msg: IncomingMessage) {
    this.url = new URL('http://' + this.msg.headers.host + this.msg.url);
    this.method = <HttpMethod>this.msg.method.toUpperCase();

    let rc = msg.headers.cookie;
    rc && rc.split(';').forEach(cookie => {
      let parts = cookie.split('=');
      this.cookies[parts.shift().trim()] = decodeURI(parts.join("="));
    })
  }

  get body() { return this._body; }
  set body(value: T) {
    if (!this._body) this._body = value;
    else throw "unable to reassign request body";
  }

  get params() { return this._params; }
  set params(value: { [key: string]: string | string[] }) {
    if (!this._params) this._params = value;
    else throw "unable to reassign request params";
  }

  header(key: string) { return this.msg.headers[key.toLowerCase()]; }

  get headers() { return this.msg.headers; }
}

/**
 * 
 * @param HTTPMsg IncomingMessage
 */
function processBody(http: IncomingMessage): Promise<any> {
  return new Promise((res, rej) => {
    let payload: Uint8Array[] = [];
    http.on("data", data => payload.push(data))
      .on('end', () => res(Buffer.concat(payload).toString()))
      .on("error", err => {
        Micro.logger.error(err);
        rej(err);
      });
  });
}

/**
 * Response wrapper over origin http.ServerResponse
 */
export class Response {
  private _ended: boolean;

  constructor(private request: Request, public readonly serverResponse: ServerResponse, cors: CORS) {
    this.serverResponse.setHeader('Cache-Control', 'no-cache,no-store,max-age=0,must-revalidate');
    this.serverResponse.setHeader('Pragma', 'no-cache');
    this.serverResponse.setHeader('Expires', '-1');
    this.serverResponse.setHeader('X-XSS-Protection', '1;mode=block');
    this.serverResponse.setHeader('X-Frame-Options', 'DENY');
    this.serverResponse.setHeader('Content-Security-Policy', "script-src 'self'");
    this.serverResponse.setHeader('X-Content-Type-Options', 'nosniff');
    this.setHeaders(cors);
  }

  get ended() { return this._ended; }

  end(cb?: () => void): void;
  end(chunck: any, cb?: () => void): void;
  end(chunck: any, encoding: string, cb?: () => void): void;
  end(chunck?: any | (() => void), encoding?: string | (() => void), cb?: () => void) {
    if (this._ended) return Micro.logger.warn('http response already sent');
    if (this.serverResponse.statusCode < 500) Micro.logger.info(`response ${this.serverResponse.statusCode} ${this.request.url.pathname}`);
    else Micro.logger.error(new Error(`response ${this.serverResponse.statusCode} ${this.request.url}`));
    this._ended = true;
    this.serverResponse.end(...arguments);
  }

  type(type: string) {
    this.serverResponse.setHeader('Content-Type', type);
    return this;
  }

  setHeaders(headers: { [key: string]: string | string[] | number }) {
    if (headers)
      for (let key in headers)
        this.serverResponse.setHeader(key, headers[key]);

    return this;
  }

  cookies(pairs: { [key: string]: string | { value: string; options: Partial<CookieOptions> } }) {
    if (!pairs) return this;
    let all: string[] = [];
    for (let [key, value] of Object.entries(pairs)) {
      if (typeof value === "string") all.push(`${key}=${value}`);
      else {
        let cookie = `${key}=${value.value}`;

        for (let optionName in value.options) {
          let option = value.options[optionName as keyof CookieOptions];
          if (typeof option === "boolean" && option) cookie += `; ${optionName}`;
          else cookie += `; ${optionName}=${option}`;

          all.push(cookie);
        }
      }
    }
    
    this.serverResponse.setHeader('Set-Cookie', all);
    return this;
  }

  json(data?: any) {
    this.serverResponse.setHeader('Content-Type', 'application/json; charset=utf-8');
    !!data ? this.end(JSON.stringify(data)) : this.end("");
  }

  status(code: CODES) {
    this.serverResponse.statusCode = code;
    return this;
  }

  redirect(url: string, code = CODES.MULTIPLE_CHOICES) {
    this.serverResponse.statusCode = code;
    this.serverResponse.setHeader("Location", url);
    this.end();
  }

  sendFile(path: string, mime: string) {
    let stat = statSync(path);

    this.serverResponse.writeHead(CODES.OK, {
      "Content_Type": mime,
      "Content-Length": stat.size 
    });

    let readStream = createReadStream(path);
    readStream.pipe(this.serverResponse);
  }
}

/**
 * Finds the matched route method declared whtin the service
 * @param url {URL}
 * @param method {HttpMethod}
 */
function findRoute(url: URL, method: HttpMethod): { route: RouteFullConfig, params: { [key: string]: string | string[] } } {
  if (!serviceRoutes || !serviceRoutes[method])
    return null;

  let pathname = PathPattern.Clean(url.pathname)
  if (serviceRoutes[method][pathname] !== undefined) return { route: serviceRoutes[method][pathname], params: {} };

  for (let routePath in serviceRoutes[method]) {
    let route = serviceRoutes[method][routePath];
    let pathPattern = new PathPattern(route.path);
    if (pathPattern.match(pathname)) return { route, params: pathPattern.params };
  }

  return <any>{};
}

function toKebabCasing(name: string) {
  if (!name) return '';

  return name.replace(/([a-z0-9][A-Z])/g, (match: string, $1: string) => {
    return $1.charAt(0) + '-' + $1.charAt(1).toLowerCase()
  });
}

export class MicroRouter extends MicroPlugin {
  private _config: RouterConfig & { name: string };
  static server: http.Server;

  healthy = true;

  constructor(config?: RouterConfig) {
    super();

    this._config = config || <any>{};
    this._config.version = this._config.version || "1";
    this._config.port = this._config.port || 3000;
    this._config.host = this._config.host || "0.0.0.0";
    this._config.cors = Object.assign(this._config.cors || {}, DEFAULT_CORS);
    if (this._config.ignoredRoutes) {
      for (let route of this._config.ignoredRoutes)
        route[0] = route[0].includes('*') ? '*' : route[0].replace(/\s?/g, '').toUpperCase();
    } else this._config.ignoredRoutes || [];

    Micro.store.MicroRouterPlugin = <any>{};
  }

  private shallBeIgnored(url: URL, method: HttpMethod) {
    let pathname = PathPattern.Clean(url.pathname);

    if (this._config.ignoredRoutes?.length > 0)
      for (let route of this._config.ignoredRoutes) {
        if (route[0] !== '*' && !route[0].includes(method)) continue;
        let pathPattern = new PathPattern(route[1]);
        if (pathPattern.match(pathname)) return true;
      }

    return false;
  }

  private async requestHandler(httpRequest: http.IncomingMessage, httpResponse: http.ServerResponse) {
    try {
      let request = new Request(httpRequest);
      let response = new Response(request, httpResponse, this._config.cors);
      let timer: NodeJS.Timeout = null;

      request.msg.on('close', () => {
        clearTimeout(timer);
      });

      Micro.logger.info(`${request.method} ${request.url.pathname}`);

      response.serverResponse.on("error", err => {
        Micro.logger.error(err, `method: ${request.method}`);
        if (typeof Micro.service.onRouteError === "function")
          Micro.service.onError(request, response, err);
      });

      if (<any>request.method === 'OPTIONS')
        return response.status(+this._config.cors['response-code']).end();

      if (typeof Micro.service.onRequest === "function") {
        let ret = Micro.service.onRequest(request, response);
        if (ret && ret.then !== undefined)
          await ret;
      }

      if (this.shallBeIgnored(request.url, request.method)) {
        Micro.logger.info(`route ignored: ${request.method} ${request.url.pathname}`);
        return;
      }

      let { route, params } = findRoute(request.url, request.method);

      if (!route) {
        if (typeof Micro.service.on404 === "function")
          return Micro.service.on404(request, response);

        return response.status(CODES.NOT_FOUND).end();
      }

      if (route.cors)
        response.setHeaders(route.cors);

      let currentService = route.service;

      if (currentService !== Micro.service && typeof currentService.onRequest === "function") {
        let ret = currentService.onRequest(request, response);

        if (ret && ret.then !== undefined)
          await ret;
      }

      if (typeof currentService[route.key] !== "function") {
        if (typeof currentService.on404 === "function")
          return currentService.on404(request, response);

        return response.status(CODES.NOT_FOUND).end();
      }

      timer = setTimeout(() => {
        response.status(CODES.REQUEST_TIMEOUT).end('request time out');
      }, route.timeout);

      request.params = params;

      let queryStr = request.url.href.split('?')[1];
      if (route.queryLength > 0 && queryStr && request.url.search.length > route.queryLength)
        return response.status(CODES.PAYLOAD_TOO_LARGE).end('request query exceeded length limit');

      if (['POST', 'PUT', 'PATCH', 'DELETE'].indexOf(request.method) > -1 && +request.msg.headers['content-length'] > 0) {
        // validate request body size
        if (route.bodyQuota > 0 && route.bodyQuota < +request.msg.headers['content-length'])
          return response.status(CODES.PAYLOAD_TOO_LARGE).end('request body exceeded size limit');

        if (route.accepts.indexOf((<string>request.header('content-type')).split(';')[0]) === -1)
          return response.status(CODES.BAD_REQUEST).json({ msg: 'invalidContentType' });

        if (route.processBody) {
          let data: any;

          try { 
            data = await processBody(request.msg);
          } catch (e) {
            return response.status(CODES.BAD_REQUEST).json({ msg: 'error processing request data', original: e });
          }

          if (route.accepts.indexOf('application/json') > -1)
            try {
              request.body = JSON.parse(data);
            } catch (e) {
              return response.status(CODES.BAD_REQUEST).json(e);
            }

          else if (route.accepts.indexOf('application/x-www-form-urlencoded') > -1)
            request.body = URL.QueryToObject(data);
          else
            request.body = data;
        }
      }

      if (route.hooks && route.hooks.length > 0) {
        let currHook: string;
        try {
          for (let hook of route.hooks) {
            // check if response already sent, that happens when hook timeout
            if (response.ended)
              return;

            currHook = hook;

            if (currentService[hook] === undefined && Micro.service[hook] === undefined)
              return Micro.logger.warn(`Hook not found: ${hook}!`);
            else if (typeof currentService[hook] !== 'function' && typeof Micro.service[hook] !== "function")
              return Micro.logger.warn(`invalid hook type: ${hook}!`);

            let ret = currentService[hook]
              ? currentService[hook](request, response, route.key)
              : Micro.service[hook](request, response, route.key);

            if (ret) {
              if (typeof ret.then === "function") {
                let passed = await ret;

                if (!passed) {
                  if (!response.ended) {
                    Micro.logger.warn('unhandled async hook response: ' + hook);
                    response.status(CODES.BAD_REQUEST).json({ msg: 'badRequest' });
                  }

                  return;
                }
              }

            } else {
              if (!response.ended) {
                Micro.logger.warn('unhandled hook response: ' + hook);
                response.status(CODES.BAD_REQUEST).json({ msg: 'badRequest' });
              }

              return;
            }
          }
        } catch (e) {
          Micro.logger.error(e, 'hook unhandled error: ' + currHook);
          response.status(CODES.UNKNOWN_ERROR).json({ msg: 'unknownError' });
        }
      }

      try {
        currentService[route.key](request, response);
      } catch (e) {
        Micro.logger.error(e, `route: ${route.key}`);
      }
      
    } catch (error) {
      Micro.logger.error(error);
    }
  }

  init() {
    if (MicroRouter.server) return;

    Micro.logger.info('initializing Http server');
    let rootPath = URL.Clean((this._config.kebabCase ? toKebabCasing(Micro.service.constructor.name) : Micro.service.constructor.name as string).toLowerCase() + '/v' + this._config.version);

    for (let config of serviceRoutesRepo) {
      let currService = Micro.getCurrentService(config.service) || Micro.service;
      let pathPrefix = '';
      if (currService !== Micro.service)
        pathPrefix = '/' + (this._config.kebabCase ? toKebabCasing(currService.constructor.name) : currService.constructor.name as string).toLowerCase();

      let route: RouteFullConfig = {
        service: currService,
        path: URL.Clean(rootPath + pathPrefix + (config.path ? '/' + URL.Clean(config.path) : '')),
        name: config.name || config.key,
        method: config.method || 'GET',
        accepts: config.accepts || 'application/json; charset=utf-8',
        hooks: config.hooks || [],
        bodyQuota: config.bodyQuota || 1024 * 100,
        processBody: config.processBody === false ? false : true,
        queryLength: config.queryLength || 100,
        timeout: (!config.timeout || config.timeout < 0) ? 1000 * 15 : config.timeout,
        key: config.key,
        cors: Object.assign(config.cors || {}, this._config.cors)
      };

      for (let hook of route.hooks)
        if (currService[hook] === undefined && Micro.service[hook] === undefined)
          Micro.logger.warn(`Hook not found: ${hook}!`);
        else if (typeof currService[hook] !== 'function' && typeof Micro.service[hook] === 'function')
          Micro.logger.warn(`invalid hook type: ${hook}!`);

      serviceRoutes[route.method] = serviceRoutes[route.method] || {};
      serviceRoutes[route.method][route.path] = route;
      Micro.logger.info(`route: ${route.path} - ${route.method} initialized`);
    }

    let server = http.createServer((req, res) => this.requestHandler(req, res));

    MicroRouter.server = server;
    Micro.logger.info('http server initialized successfully');

    server.listen(this._config.port, this._config.host, () => {
      Micro.logger.info(`running http server on port: ${this._config.port}, pid: ${process.pid}`);

      if (typeof Micro.service.onListening === "function")
        Micro.service.onListening();

      for (let service of Micro.subServices)
        if (typeof service.onListening === "function")
          service.onListening();
    });

    this.ready = true;
    this.live = true;
  }
}