/*global require, process*/
(function () {
  'use strict';

  var Boom = require('boom');
  var Concat = require('concat-stream');
  var Hapi = require('hapi');
  var Image = require('imagemagick-stream');
  var Joi = require('joi');
  var LRU = require('bluebird-lru-cache');
  var Promise = require('bluebird');
  var Screenshot = require('screenshot-stream');
  var nconf = require('nconf');

  nconf
    .argv()
    .env()
    .file({file: 'config.json'});

  if (!nconf.get('runURL')) {
    throw new Error('runURL environment variable is required.');
  }
  if (!nconf.get('port')) {
    throw new Error('port environment variable is required.');
  }

  var runURL = nconf.get('runURL');
  var port = nconf.get('port');

  var server = new Hapi.Server(process.env.HOST || '0.0.0.0', port, {
    state: {
      cookies: {
        failAction: 'log'
      }
    }
  });

  setTimeout(function () {
    server.log('info', 'Server exceeded maximum lifetime, exiting.');
    process.exit(0);
  }, 1000 * 60 * 60);

  var internals = {};

  internals.runUrl = runURL;

  internals.prepareShot = function (key) {
    var plunkId = key.split('@')[0];

    return new Promise(function (resolve, reject) {
      var captureStream = Screenshot(internals.runUrl + '/plunks/' + plunkId + '/', '1024x768', {delay: 2});
      var resizeStream = Image().resize('248').gravity('NorthWest').crop('248x372').quality(75);
      var concatStream = Concat(function (buf) {
        if (!buf.length) {
          return reject(Boom.serverTimeout('Invalid preview, empty buffer'));
        }

        resolve(buf);
      });

      captureStream
        .pipe(resizeStream)
        .pipe(concatStream)
        .on('error', reject);
    });
  };


  internals.cache = LRU({
    max: 1024 * 1024 * 256,
    length: function (buf) { return buf.length; },
    fetchFn: internals.prepareShot
  });

  server.route({
    method: 'GET',
    path: '/{plunkId}.png',
    config: {
      validate: {
        params: {
          plunkId: Joi.string().alphanum().required()
        },
        query: {
          d: Joi.string().required()
        }
      },
      handler: function (request, reply) {
        internals.cache.get(request.params.plunkId + '@' + request.query.d)
          .then(function (buf) {
            reply(buf).type('image/png');
          }, reply);
      }
    }
  });

  server.pack.register({
    plugin: require('good')
    // options: {
    //   subscribers: {
    //     'console': [],
    //     '/tmp/webshot/': ['request', 'log', 'error'],
    //   },
    // },
  }, function (err) {
    if (err) {
      throw err; // something bad happened loading the plugin
    }

    server.start(function () {
      server.log('info', 'Server running at: ' + server.info.uri);
    });
  });

})();

