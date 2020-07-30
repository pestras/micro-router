import { MicroPlugin, HttpMethod, Service, Micro, LOGLEVEL, CODES } from '@pestras/micro';
import { IncomingMessage, Server, ServerResponse, IncomingHttpHeaders } from 'http';
import { URL } from '@pestras/toolbox/url';
import { PathPattern } from '@pestras/toolbox/url/path-pattern';

export interface RouterEvents {
  onRequest?: (req: Request, res: Response) => void;
  on404?: (req: Request, res: Response) => void;
  onRouteError?: (req: Request, res: Response, err: any) => void;
}

export type CORS = IncomingHttpHeaders & { 'response-code'?: string };

const DEFAULT_CORS: IncomingHttpHeaders & { 'success-code'?: string } = {
  'access-control-allow-methods': "GET,HEAD,OPTIONS,PUT,PATCH,POST,DELETE",
  'access-control-allow-origin': "*",
  'access-control-allow-headers': "*",
  'Access-Control-Allow-Credentials': 'false',
  'success-code': '204'
}

/**
 * Request wrapper for original node incoming message
 * include url and body parsing
 */
export class Request<T = any> {
  private _body: T = null;
  private _params: { [key: string]: string | string[] } = null;
  readonly url: URL;
  readonly method: HttpMethod;
  readonly locals: { [key: string]: any } = {};
  auth?: any;

  constructor(public readonly msg: IncomingMessage) {
    this.url = new URL('http://' + this.msg.headers.host + this.msg.url);
    this.method = <HttpMethod>this.msg.method.toUpperCase();
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
    serviceRoutesRepo.push({ key, ...config });
  }
}

/** Hooks Repo */
const hooksRepo: string[] = [];

/** Hook Decorator */
export function ROUTE_HOOK() {
  return (target: any, key: string) => {
    hooksRepo.push(key);
  }
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
    let mode: LOGLEVEL = this.serverResponse.statusCode < 500 ? LOGLEVEL.INFO : LOGLEVEL.ERROR;
    if (this.serverResponse.statusCode < 500) Micro.logger.info(`response ${this.serverResponse.statusCode} ${this.request.url.pathname}`);
    else Micro.logger.error(`response ${this.serverResponse.statusCode} ${this.request.url}`);
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

  json(data?: any) {
    this.serverResponse.setHeader('Content-Type', 'application/json; charset=utf-8');
    !!data ? this.end(JSON.stringify(data)) : this.end("");
  }

  status(code: CODES) {
    this.serverResponse.statusCode = code;
    return this;
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

export class MicroRouter extends MicroPlugin {
  private cors: CORS;

  constructor(cors: CORS = null) {
    super();

    this.cors = Object.assign(cors || {}, DEFAULT_CORS);
  }

  init() {
    for (let config of serviceRoutesRepo) {
      let route: RouteFullConfig = {
        path: URL.Clean(Micro.config.name + '/v' + Micro.config.version + (config.path || '')),
        name: config.name || config.key,
        method: config.method || 'GET',
        accepts: config.accepts || 'application/json; charset=utf-8',
        hooks: config.hooks || [],
        bodyQuota: config.bodyQuota || 1024 * 100,
        processBody: config.processBody === false ? false : true,
        queryLength: config.queryLength || 100,
        timeout: (!config.timeout || config.timeout < 0) ? 1000 * 15 : config.timeout,
        key: config.key
      };

      for (let hook of route.hooks)
        if (Micro.service[hook] === undefined) Micro.logger.warn(`Hook not found: ${hook}!`);
        else if (typeof Micro.service[hook] !== 'function') Micro.logger.warn(`invalid hook type: ${hook}!`);

      serviceRoutes[route.method] = serviceRoutes[route.method] || {};
      serviceRoutes[route.method][route.path] = route;
      Micro.logger.info(`route: ${route.path} - ${route.method} initialized`);
    }
  }

  async onHTTPMsg(httpMsg: IncomingMessage, httpRes: ServerResponse) {
    let request = new Request(httpMsg);
    let response = new Response(request, httpRes, this.cors);
    let timer: NodeJS.Timeout = null;

    request.msg.on('close', () => {
      clearTimeout(timer);
    });

    response.serverResponse.on("error", err => {
      Micro.logger.error(err, { method: request.method });
      if (typeof Micro.service.onRouteError === "function") Micro.service.onError(request, response, err);
    });

    if (<any>request.method === 'OPTIONS') return response.status(+this.cors['response-code']).end();

    if (typeof Micro.service.onRequest === "function") {
      let ret = Micro.service.onRequest(request, response);
      if (ret && ret.then !== undefined) await ret;
    }

    let { route, params } = findRoute(request.url, request.method);

    if (!route) {
      if (typeof Micro.service.on404 === "function") return Micro.service.on404(request, response);
      return response.status(CODES.NOT_FOUND).end();
    }

    if (typeof Micro.service[route.key] !== "function") {
      if (typeof Micro.service.on404 === "function") return Micro.service.on404(request, response);
      return response.status(CODES.NOT_FOUND).end();
    }

    if (route.cors) response.setHeaders(route.cors);

    timer = setTimeout(() => {
      response.status(CODES.REQUEST_TIMEOUT).end('request time out');
    }, route.timeout);

    // inject params
    request.params = params;

    // validate query string length
    let queryStr = request.url.href.split('?')[1];
    if (route.queryLength > 0 && queryStr && request.url.search.length > route.queryLength)
      return response.status(CODES.REQUEST_ENTITY_TOO_LARGE).end('request query exceeded length limit');

    if (['POST', 'PUT', 'PATCH', 'DELETE'].indexOf(request.method) > -1 && +request.msg.headers['content-length'] > 0) {
      // validate reeuest body size
      if (route.bodyQuota > 0 && route.bodyQuota < +request.msg.headers['content-length'])
        return response.status(CODES.REQUEST_ENTITY_TOO_LARGE).end('request body exceeded size limit');

      if (route.accepts.indexOf((<string>request.header('content-type')).split(';')[0]) === -1)
        return response.status(CODES.BAD_REQUEST).json({ msg: 'invalidContentType' });

      if (route.processBody) {
        try { request.body = await processBody(request.msg); }
        catch (e) { return response.status(CODES.BAD_REQUEST).json({ msg: 'error processing request data', original: e }); }

        if (route.accepts.indexOf('application/json') > -1)
          try { request.body = JSON.parse(request.body); } catch (e) { return response.status(CODES.BAD_REQUEST).json(e); }
        else if (route.accepts.indexOf('application/x-www-form-urlencoded') > -1)
          request.body = URL.QueryToObject(request.body);
      }
    }

    // start hooks flow
    if (route.hooks && route.hooks.length > 0) {
      let currHook: string;
      try {
        for (let hook of route.hooks) {
          // check if response already sent, that happens when hook timeout
          if (response.ended) return;

          currHook = hook;

          if (Micro.service[hook] === undefined) return Micro.logger.warn(`Hook not found: ${hook}!`);
          else if (typeof Micro.service[hook] !== 'function') return Micro.logger.warn(`invalid hook type: ${hook}!`);

          let ret = Micro.service[hook](request, response, route.key);
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
        Micro.logger.error('hook unhandled error: ' + currHook, e);
        response.status(CODES.UNKNOWN_ERROR).json({ msg: 'unknownError' });
      }
    }

    try { Micro.service[route.key](request, response); }
    catch (e) { Micro.logger.error(e, { route: route.key }); }
  }
}