#!/usr/bin/env node

var httpProxy      = require('http-proxy'),
    config         = require('./config');
    fs             = require('fs');

//
// ---------------------- proxy and handler --------------------------
//

function isEmpty(value) {
  return typeof value == 'string' && !value.trim() || typeof value == 'undefined' || value === null;
}

function checkImpersonate() {
  return !isEmpty(config.impersonate_identity) && !isEmpty(config.impersonate_users) ;
}

function isAllowed(user) {
  if ( checkImpersonate()) {
    users_as_array = config.impersonate_users.split(",");
    return users_as_array.indexOf(user) > -1;
  }
  return false 
}

function impersonate(user) {
  if ( checkImpersonate()) {
    if (isAllowed(user)) {
      console.log("== impersonnate %s with %s", user, config.impersonate_identity);
      return config.impersonate_identity;
    } else {
      console.log("== NOT impersonnate : user %s is not in with %s", user, config.impersonate_users);
    }
  }
  console.log("== NOT impersonnate %s : configuration is missing", user);
  return user;
}

module.exports = {
  setupProxy: function(app, userForRequest) {
    //
    // Implement the configured proxy request transform(s)
    //
    var proxyTransformer = function (proxyReq, req, res, options) {

      if ( checkImpersonate() && !isAllowed(userForRequest(req).name)) {
        res.status(401);
        return;
      }

      config.debugLog('in proxyTransformer content-length is', req.headers['content-length']);
      config.transforms.forEach(function (name){
        switch (name) {
          case 'user_header':
            var userName = impersonate(userForRequest(req).name);
            config.debugLog('setting %s header to "%s"', config['user-header'], userName);
            proxyReq.setHeader(config['user-header'], userName);
            break;
          case 'token_header':
            var token = userForRequest(req).token;
            if (token) {
                config.debugLog('setting Authorization header');
                if (isAllowed(userForRequest(req).name)) {
                    var data = fs.readFileSync('/run/secrets/kubernetes.io/serviceaccount/token', 'utf8');
                    console.log("== replacing Bearer with SA token");
                    proxyReq.setHeader('Authorization', 'Bearer ' + data);
                } else {
                    console.log("== configuration is missing or user is not allowed, use user token");
                    proxyReq.setHeader('Authorization', 'Bearer ' + token);
                }
            }
            break;
        }
      });
    }

    //
    // Set up the proxy server to delegate to our handlers
    //
    var proxy = new httpProxy.createProxyServer({
      target: config.backend,
      changeOrigin: config['use-backend-host-header'],
      agent: config.backendAgent,
      ws: true
    });
    proxy.on('error', function(e) {
      console.error('proxy error: %s', JSON.stringify(e));
    });
    proxy.on('proxyReq', proxyTransformer);
    app.use(function(req, res) { proxy.web(req, res); });
  }
}