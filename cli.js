var searedis = require('./').connect();

searedis.query(function (err, services) {
	console.log(services);
	searedis.close();
});
