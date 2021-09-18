const SCWorker = require('socketcluster/scworker');
const fs = require('fs');
const express = require('express');
const serveStatic = require('serve-static');
const path = require('path');
const dummyData = require('./sc_modules/dummy-data');
const authentication = require('./sc_modules/authentication');
const scCrudRethink = require('sc-crud-rethink');

class Worker extends SCWorker {
  run() {
    console.log('   >> Worker PID:', process.pid);

    const httpServer = this.httpServer;
    const scServer = this.scServer;

    // Use ExpressJS to handle serving static HTTP files
    const app = require('express')();
    app.use(serveStatic(path.resolve(__dirname, 'public')));
    httpServer.on('request', app);

    /*
      Here we attach some modules to scServer - Each module injects their own logic into the scServer to handle
      a specific aspect of the system/business logic.
    */

    const thinky = scCrudRethink.thinky;
    const type = thinky.type;

    const crudOptions = {
      defaultPageSize: 5,
      schema: {
        Category: {
          fields: {
            id: type.string(),
            name: type.string(),
            desc: type.string().optional()
          },
          views: {
            alphabeticalView: {
              affectingFields: ['name'],
              transform: function (fullTableQuery, r) {
                return fullTableQuery.orderBy(r.asc('name'));
              }
            }
          },
          filters: {
            pre: mustBeLoggedIn
          }
        },
        Product: {
          fields: {
            id: type.string(),
            name: type.string(),
            qty: type.number().integer().optional(),
            price: type.number().optional(),
            desc: type.string().optional(),
            category: type.string()
          },
          views: {
            categoryView: {
              // Declare the fields from the Product model which are required by the transform function.
              paramFields: ['category'],
              affectingFields: ['name'],
              transform: function (fullTableQuery, r, productFields) {
                // Because we declared the category field above, it is available in here.
                // This allows us to tranform/filter the Product collection based on a specific category
                // ID provided by the frontend.
                return fullTableQuery.filter(r.row('category').eq(productFields.category)).orderBy(r.asc('name'));
              }
            },
            lowStockView: {
              // Declare the fields from the Product model which are required by the transform function.
              paramFields: ['category', 'qty'],
              primaryKeys: ['category'],
              transform: function (fullTableQuery, r, productFields) {
                // Because we declared the category field above, it is available in here.
                // This allows us to tranform/filter the Product collection based on a specific category
                // ID provided by the frontend.
                return fullTableQuery.filter(r.row('category').eq(productFields.category)).filter(r.row('qty').le(productFields.qty)).orderBy(r.asc('qty'));
              }
            }
          },
          filters: {
            pre: mustBeLoggedIn,
            post: postFilter
          }
        },
        User: {
          fields: {
            username: type.string(),
            password: type.string()
          },
          filters: {
            pre: mustBeLoggedIn
          }
        }
      },

      thinkyOptions: {
        host: process.env.DATABASE_HOST || '127.0.0.1',
        port: process.env.DATABASE_PORT || 28015
      }
    };

    function mustBeLoggedIn(req, next) {
      if (req.socket.authToken) {
        next();
      } else {
        next(true);
        req.socket.emit('logout');
      }
    }

    function postFilter(req, next) {
      // The post access control filters have access to the
      // resource object from the DB.
      // In case of read actions, you can even modify the
      // resource's properties before it gets sent back to the user.
      next();
    }

    const crud = scCrudRethink.attach(this, crudOptions);
    scServer.thinky = crud.thinky;

    // Add some dummy data to our store
    dummyData.attach(scServer, crud);

    /*
      In here we handle our incoming realtime connections and listen for events.
    */
    scServer.on('connection', function (socket) {
      /*
        Attach some modules to the socket object - Each one decorates the socket object with
        additional features or business logic.
      */

      // Authentication logic
      authentication.attach(scServer, socket);
    });
  }
}

new Worker();
