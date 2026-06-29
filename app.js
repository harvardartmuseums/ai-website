var cookieParser = require('cookie-parser');
var createError = require('http-errors');
var express = require('express');
var fs = require('fs');
var hbs = require('hbs');
var helpers = require('handlebars-helpers')({
	handlebars: hbs
});
var logger = require('morgan');
var path = require('path');
var rateLimit = require('express-rate-limit');
var routes = require('./routes/routes');
var app = express();

app.set('trust proxy', 1);

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
hbs.registerHelper('ne', function (a, b) { return a !== b; });
hbs.registerPartials(path.join(__dirname, '/views/partials'));
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));

// Bot blocker — reject requests from user-agents listed in robots.txt
const botPatterns = fs.readFileSync(path.join(__dirname, 'public/robots.txt'), 'utf8')
  .split('\n')
  .filter(l => l.startsWith('User-agent:'))
  .map(l => l.replace('User-agent:', '').trim().toLowerCase());

app.use((req, res, next) => {
  const ua = (req.get('user-agent') || '').toLowerCase();
  const match = botPatterns.find(p => ua.includes(p));
  if (match) {
    console.log(`Blocked bot: ${match} | ${req.method} ${req.originalUrl} | ${req.ip}`);
    return res.status(403).end();
  }
  next();
});

// Rate limiter — 100 requests per minute per IP
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    console.log(`Rate limited: ${req.ip} | ${req.method} ${req.originalUrl}`);
    res.status(429).end();
  },
}));

app.use(redirectToSSL(['staging', 'production']));
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
