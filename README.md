# Pestras Micro Router

Pestres microservice plugin for rest services support

Although **PMS** is almost empty of features, its strength comes handy through its plugins.

## install

```bash
npm i @pestras/micro @pestras/micro-router
```

## Template

```bash
$ git clone https://github.com/pestras/pestras-micro-template
```

## Plug In

```ts
import { SERVICE, Micro } from '@pestras/micro';
import { MicroRouter } from '@pestras/micro-router;

Micro.plugin(new MicroRouter());

@SERVICE()
class test {}

Micro.start(Test);
```

**MicroRouter** class accepts a single optional argument **cors**.

Default cors options are:

```
'access-control-allow-methods': "GET,HEAD,OPTIONS,PUT,PATCH,POST,DELETE",
'access-control-allow-origin': "*",
'access-control-allow-headers': "*",
'Access-Control-Allow-Credentials': 'false',
'success-code': '204'
```

## ROUTE DECORATOR

Used to define a route for a rest service.

**ROUTE** accepts an optional config object to configure our route.

Name | type | Default | Description
--- | --- | --- | --- 
name | string | Method name applied to | name of the route
path | string | '/' | Service path pattern
method | HttpMethod | 'GET' | 
accepts | string | 'application/json' | shortcut for 'Content-Type' header
hooks | string[] | [] | hooks methods that should be called before the route handler
bodyQuota | number | 1024 * 100 | Request body size limit
queryLength | number | 100 | Request query characters length limit
timeout | number | 15000 | Max time to handle the request before canceling
cors | IncomingHttpHeaders & { 'success-code'?: string } | null | CORS for preflights requests

```ts
import { SERVICE, ROUTE } from '@pestras/microservice';

@SERVICE({
  version: 1
})
class Articles {

  @ROUTE({
    // /articles/v1/{id}
    path: '/{id}'
  })
  getArticle(req: Request, res: Response) {
    let id = req.params.id;

    // get article code

    res.json(article);
  }
}
```

### Request

**PMS** http request holds the original Node IncomingMessage with a few extra properties.

Name | Type | Description
--- | --- | ---
url | URL | URL extends Node URL class with some few properties, most used one is *query*.
params | { [key: string]: string \| string[] } | includes route path params values.
body | any |
auth | any | useful to save some auth value passed from 'auth' hook for instance.
headers | IncomingHttpHeaders | return all current request headers.
header | (key: string) => string | method to get specific request header value
locals | Object | to set any additional data passed between hooks and route handler
msg | NodeJS.IncomingMessage | 

### Request Path Patterns

**PM** path patterns are very useful that helps match specific cases

1. **/articles/{id}** - *id* is a param name that match any value: */articles/4384545* or */articles/45geeFEe8* but not */articles* or */articles/dsfge03tG9/1*

2. **/articles/{id}?** - same the previous one but id params is optional, so */articles* is acceptable.

3. **/articles/{cat}/{start}?/{limit}?** - cat params is required, however start and limit are optionals,
*/articles/scifi*, */articles/scifi/0*, */articles/scifi/0/10* all matched

4. **/articles/{id:^[0-9]{10}$}** - id param is constrained with a regex that allow only number value with 10 digits length only.

5. **/articles/*** - this route has rest operator which holds the values of the rest blocks of the path separated by '/' as an array,
*articles/scifi/0/10* does match and **request.params['\*']** equals ['scifi','0','10'], however */articles* does not match

6. **/articles/\*?** - same as the previous however */articles* does match

#### notes:

- Rest operator accepts preceding parameter but not optional parameters.
- Adding flags to regexp would be */articles/{id:[a-z]{10}**:i**}*.
- Parameters with Regexp can be optional as will */articles/{id:[a-z]{10}**:i**}?*
- Parameters can be seperated by fixed value blocks */articles/{aid}/comments/{cid}*
- Parameters and rest operator can be seperated by fixed value blocks as well.
- On each request, routes are checked in two steps to enhance performance
  - Perfect match: Looks for the perfect match (case sensetive).
  - By Order: if first step fail, then routes are checked by order they were defined (case insensetive)

```ts
@SERVICE()
class AticlesQuery {
  // first to check
  @ROUTE({ path: '/{id}'})
  getById() {}
  
  // second to check
  @ROUTE({ path: '/published' })
  getPublished() {}
  
  /**
   * Later when an incomimg reauest made including pathname as: 'articles-query/v0/Published' with capitalized P
   * first route to match is '/{id}',
   * However when the path name is 'articles-query/v0/published' with lowercased p '/published' as the defined route then
   * the first route to match is '/published' instead of '/{id}'
   */
}
```

### Response

**PMS** http response holds the original Node Server Response with a couple of methods.

Name | Type | Description
--- | --- | ---
json | (data?: any) => void | Used to send json data.
status | (code: number) => Response | Used to set response status code.
type | (contentType: string) => void | assign content-type response header value.
end | any | Overwrites orignal end method *recommended to use*
setHeaders | (headers: { [key: string]: string \| string[] \| number }) => void | set multiple headers at once
http | NodeJS.ServerResponse | 

Using response.json() will set 'content-type' response header to 'application/json'.
**Response** will log any 500 family errors automatically.

#### Response Security headers

**PM** add additional response headers for more secure environment as follows:

```
'Cache-Control': 'no-cache,no-store,max-age=0,must-revalidate'
'Pragma': 'no-cache'
'Expires': '-1'
'X-XSS-Protection': '1;mode=block'
'X-Frame-Options': 'DENY'
'Content-Security-Policy': "script-src 'self'"
'X-Content-Type-Options': 'nosniff'
```

Headers can be overwritten using **response.setHeaders** method.

## ROUTER_HOOK DECORATOR

Hooks are called before the actual request handler, they are helpful for code separation like auth, input validation or whatever logic needed, they could be sync or async returning boolean value.

```ts
import { Micro, SERVICE, Request, Response, ROUTER_HOOK, ROUTE, CODES } from '@pestras/microservice';

@SERVICE()
class Test {
  @ROUTER_HOOK()
  async auth(req: Request, res: Response, handlerName: string) {
    const user: User;
  
    // some auth code
    // ...

    if (!user) {
      res.status(CODES.UNAUTHORIZED).json({ msg: 'user not authorized' });
      return false;
    }
  
    req.auth = user;
    return true
  }

  @ROUTE({ hooks: ['auth'] })
  handlerName(req: Request, res: Response) {
    const user = req.auth;
  }
}

Micro.start(Test);
```

Hooks should handle the response on failure and returning or resolving to false, otherwise **Route** will check response status and if its not ended, it will consider the situation as a bad request from client that did not pass the hook and responding with BAD_REQUEST code 400.

## Router Events

### onRequest

Called whenever a new http request is received, passing the Request and Response instances as arguments, it can return a promise or nothing;

```ts
@SERVICE()
class Publisher implements ServiceEvents {

  async onRequest(req: Request, res: Response) { }
}
```

This event method is called before checking if there is a matched route or not.

## on404

Called whenever http request has no route handler found.

```ts
@SERVICE()
class Publisher implements ServiceEvents {

  on404(req: Request, res: Response) {

  }
}
```

When implemented response should be implemented as well

## onRouteError

Called whenever an error accured when handling an http request, passing the Request and Response instances and the error as arguments.

```ts
@SERVICE({ workers: 4 })
class Publisher implements ServiceEvents {

  onRouteError(req: Request, res: Response, err: any) { }
}
```

Thank you