var table = require('text-table');

module.exports = function (program, searedis) {
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
