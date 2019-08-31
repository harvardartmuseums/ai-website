var async = require('async');
var bodyParser = require('body-parser');
var cookieParser = require('cookie-parser');
var createError = require('http-errors');
var express = require('express');
var exphbs = require('express-handlebars');
var fetch = require('node-fetch')
var logger = require('morgan');
var path = require('path');
var routes = require('./routes/routes');
var app = express();

require('dotenv').config({path: '.env'})
require('cross-fetch/polyfill');

const API_KEY = process.env['API_KEY']

var hbs = exphbs.create();

// view engine setup
app.engine('handlebars', hbs.engine);
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/', routes);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
