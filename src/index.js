const json = (data, status = 200, origin = '*') => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'access-control-allow-headers': 'Content-Type, Authorization, X-Setup-Key'
  }
});

async function __siperpusDeployMarker(){return true;}
