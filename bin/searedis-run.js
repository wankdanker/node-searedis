var spawn = require('child_process').spawn;

module.exports = function (program, searedis) {
	searedis.register(program.role, function (err, service) {
		program.args.shift();

		var env = {
			PORT : service.port
		};

		var opts = {
			env : env
			, stdio : 'inherit'
		};


		var args = (program.args[0] || "").trim().split(/ /gi);
		var cmd = args.shift();
		
		if (!cmd) {
			program.help()
		}

		var child = spawn(cmd, args, opts);

		child.on('exit', function (code, sig) {
			//todo: re-run if failure
			searedis.close();
		});
	});
}
