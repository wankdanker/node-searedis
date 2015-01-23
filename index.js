var redis = require('redis')
	, jsonify = require('redis-jsonify')
	, myip = require('my-ip')
	, semver = require('semver')
	, EventEmitter = require('events').EventEmitter
	, inherits = require('util').inherits
	;

module.exports = SeaRedis;

SeaRedis.connect = function (host, port) {
	EventEmitter.call(this);

	var opts;

	if (typeof host === 'object') {
		opts = host;
	}
	else {
		opts = {
			host : host
			, port : port
		};
	}

	return new SeaRedis(opts);
};

inherits(SeaRedis, EventEmitter);

function SeaRedis (opts) {
	var self = this;

	opts = opts || {};
	opts.port = opts.port || 6379;

	self.registrationTimeout = opts.registrationTimeout || 10000;
	self.prefix = opts.prefix || 'SeaRedis';
	self.redis = redis.createClient(opts.port, opts.host);
	self.redisNotifications = redis.createClient(opts.port, opts.host);
	self.initialized = false;
	self.services = {};
	self.servicesDispersed = {};

	jsonify(self.redis);

	self.redisNotifications.psubscribe('__keyspace@*__:"' + self.prefix + ':*');
	self.redisNotifications.on('pmessage', function (pattern, key, event) {
		if (event === 'expired' || event === 'del') {
			key = /\"([^\"]*)"/.exec(key)[1];

			var parsedKey = parseKey(key);

			self.emit('free', self.servicesDispersed[parsedKey.id] || parsedKey);
				
			if (self.servicesDispersed[parsedKey.id]) {
				self.servicesDispersed[parsedKey.id].emit('free');

				//since this service is now gone, delete it
				delete self.servicesDispersed[parsedKey.id];
			}
		}
	});
}

SeaRedis.prototype.close = function () {
	var self = this;

	self.free(function () {
		self.redis.unref();
		self.redisNotifications.unref();
		self.redis.end();
		self.redisNotifications.end();
	});
};

SeaRedis.prototype.nextIndex = function (cb) {
	var self = this;

	self.redis.incr(self.key('index'), cb);
};

SeaRedis.prototype.register = function (role, opts, cb) {
	var self = this;

	if (typeof opts === 'function') {
		cb = opts;
		opts = {};
	}

	self.nextIndex(function (err, index) {
		if (err) {
			return cb(err);
		}
		
		var parsedRole = parseRole(role);

		var service = {
			role : parsedRole.role
			, version : parsedRole.version
			, id : index
			, address : opts.address || myip()
			, port : opts.port || (10000 + Math.floor(Math.random() * 55000))
			, opts : opts
		};

		//encode everything right in the key
		service.key = self.key(service.role
			, service.version
			, service.id
			, service.address
			, service.port
		);

		self.services[role] = self.services[role] || [];

		register(service, function (err, result) {
			if (result === 'OK') {
				self.services[role].push(new SeaRedisService(service));
			}

			service.interval = setInterval(function () {
				self.redis.expire(service.key, self.registrationTimeout / 1000); 
			}, self.registrationTimeout / 2);

			return cb(err, service);
		});
	});

	function register (service, cb) {
		self.redis.setex(service.key
			, self.registrationTimeout / 1000
			, service
			, cb
		);
	}
};

SeaRedis.prototype.query = function (role, cb) {
	var self = this;

	if (typeof role === 'function') {
		cb = role;
		role = null;
	}

	var  parsedRole = parseRole(role)
		, search = self.key(parsedRole.role || '*', '*')
		;

	self.redis.keys(search, function (err, result) {
		if (!result.length) {
			return cb(null, []);
		}

		var matches = [];

		result.forEach(function (role) {
			//have to JSON parse the key because it's not parsed automatically
			//by redis-jsonfiy
			role = JSON.parse(role);

			var parsedKey = parseKey(role);

			if (!parsedRole.role || !parsedKey.version && !parsedRole.version || semver.satisfies(parsedKey.version, parsedRole.version)) {
				//this allows us to keep track of the services that we've handed
				//out so that we can later emit events on those services that
				//have been handed out; aka: dispersed
				if (!self.servicesDispersed[parsedKey.id]) {
					self.servicesDispersed[parsedKey.id] = new SeaRedisService(parsedKey);
				}

				matches.push(self.servicesDispersed[parsedKey.id]);
			}
		});

		if (!matches.length) {
			return cb(null, []);
		}

		return cb(null, matches);
	});
};

SeaRedis.prototype.get = function (role, cb) {
	var self = this;

	self.query(role, function (err, services) {
		if (err || services.length) {
			return cb(err, services);
		}

		//nothing was returned, try again in a few
		setTimeout(self.get.bind(self, role, cb), 500);
	});
};

SeaRedis.prototype.free = function (targetRole, cb) {
	var self = this
		, pending = 0
		;
	if (typeof targetRole == 'function') {
		cb = targetRole;
		targetRole = null;
	}

	if (!Object.keys(self.services).length) {
		return cb();
	}

	//go through all of the registered services and roles
	Object.keys(self.services).forEach(function (role) {
		//don't process further if we don't want to free this role
		if (targetRole && targetRole !== role) {
			return;
		}

		//otherwise free each service for this role
		self.services[role].forEach(function (service) {
			clearInterval(service.interval);
			
			pending += 1;

			self.redis.del(service.key, function () {
				//TODO: check for errors?

				pending -= 1;
				
				if (pending === 0) {
					delete self.services[role];
					return cb && cb();
				}
			});
		});
	});

	return self;
};

SeaRedis.prototype.key = function () {
	var self = this;

	return [self.prefix]
		.concat(Array.prototype.slice.call(arguments))
		.join(':')
	;
};

function parseRole (role) {
	role = role || "";

	return {
		role : role.split('@')[0]
		, version : role.split('@')[1]
	};
}

function parseKey (key) {
	return {
		role : key.split(':')[1]
		, version : key.split(':')[2]
		, id : key.split(':')[3]
		, address : key.split(':')[4]
		, port : key.split(':')[5]
		, key : key
	};
}

function SeaRedisService (init) {
	EventEmitter.call(this);
	
	var self = this;

	self.id = init.id;
	self.role = init.role;
	self.version = init.version;
	self.address = init.address;
	self.port = init.port;
	self.key = init.key;
}

inherits(SeaRedisService, EventEmitter);

