var cookieParser = require('cookie-parser');
var createError = require('http-errors');
var express = require('express');
var hbs = require('hbs');
var helpers = require('handlebars-helpers')({
	handlebars: hbs
});
var logger = require('morgan');
var path = require('path');
var routes = require('./routes/routes');
var app = express();

require('dotenv').config({path: '.env'})

const API_KEY = process.env['API_KEY']


//------------------------------------------------------------------------------
//
// SSL stuff specific to running this app on Heroku.
//
//------------------------------------------------------------------------------
var redirectToSSL = function(environments) {
	return function(request, response, next) {
		if (environments.indexOf(process.env.NODE_ENV) > -1) {
      		if (request.headers['x-forwarded-proto'] != 'https') {
				response.redirect(301, 'https://' + request.host + request.originalUrl);
      		} else {
      			request.original_protocol = 'https';
      			next();
      		}
		} else {
			request.original_protocol = request.protocol;
			next();
		}
	}
};

// view engine setup
hbs.registerHelper('number', function (i) { return 	i.toLocaleString();});
hbs.registerPartials(path.join(__dirname, '/views/partials'));
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use(redirectToSSL(['staging', 'production']));
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
