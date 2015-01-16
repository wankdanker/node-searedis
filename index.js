var redis = require('redis')
	, jsonify = require('redis-jsonify')
	, myip = require('my-ip')
	, semver = require('semver')
	;

module.exports = SeaRedis;

SeaRedis.connect = function (host, port) {
	return new SeaRedis({
		host : host
		, port : port
	});
}


function SeaRedis (opts) {
	var self = this;

	opts = opts || {};
	opts.port = opts.port || 6379;

	self.registrationTimeout = opts.registrationTimeout || 10000;
	self.prefix = opts.prefix || 'SeaRedis';
	self.redis = redis.createClient(opts.port, opts.host);
	self.initialized = false;
	self.services = {};

	jsonify(self.redis);
}

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
				self.services[role].push(service);
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

SeaRedis.prototype.get = function (role, cb) {
	var self = this
		, parsedRole = parseRole(role)
		, search = self.key(parsedRole.role, '*')
		;

	self.redis.keys(search, function (err, result) {
		if (!result.length) {
			//TODO: wait and try again until one becomes available.
			return cb(null, []);
		}

		var matches = [];

		result.forEach(function (role) {
			//have to JSON parse the key because it's not parsed automatically
			//by redis-jsonfiy
			role = JSON.parse(role);

			var parsedKey = parseKey(role);

			if (!parsedKey.version && !parsedRole.version || semver.satisfies(parsedKey.version, '^' + parsedRole.version)) {
				matches.push(parsedKey);
			}
		});

		if (!matches.length) {
			//TODO: just wait longer

			return cb(null, []);
		}

		return cb(null, matches);
	});
};

SeaRedis.prototype.free = function (role, cb) {
	var self = this;

	if (!role) {
		//remove all of the services that this instance has registered
		Object.keys(self.services).forEach(function (role) {
			self.services[role].forEach(function (service) {
				clearInterval(service.interval);

				//TODO: check for errors?
				self.redis.del(service.key);
			});
		});

		self.service = {};
	}
};

SeaRedis.prototype.key = function () {
	var self = this;

	return [self.prefix]
		.concat(Array.prototype.slice.call(arguments))
		.join(':')
	;
};

function parseRole (role) {
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
	};
}

a = new SeaRedis();

a.register('role', function () {
	a.get('role', function (err, services) {
		console.log(arguments);
	});

	setTimeout(function () {
		console.log('calling free');
		a.free();
	}, 1000);
});


