
a = require('./').connect();

a.register('role', function () {
	a.get('role', function (err, services) {
		console.log(arguments);
		services[0].on('free', function () {
			console.log('received free event on individual service');
		});
	});

	setTimeout(function () {
		console.log('calling free');
		a.free();
	}, 1000);
});


