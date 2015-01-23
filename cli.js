#!/usr/bin/env nodejs

var program = require('commander')
    , package = require('./package')
    , table = require('text-table')
    ;

program
    .version(package.version)
    .option('-h, --host <s>', 'redis server')
    .option('-p, --port <n>', 'redis port', Number)
    .parse(process.argv);

if (!program.args.length) {
    program.help();

}

var searedis = require('./').connect({
    port : program.port || 6379
    , host : program.host || '127.0.0.1'
});

if (~program.args.indexOf('list')) {
    searedis.query(function (err, services) {
        var columns = ['role', 'version', 'address', 'port', 'id'];
        var data    = [columns];

        data.push(['----', '-------', '-------', '----', '--']);


        services.forEach(function (service) {
            var tmp = [];

            columns.forEach(function (column) {
                tmp.push(service[column]);
            });

            data.push(tmp);
        });

        console.log(table(data));

        searedis.close();
    });
}
