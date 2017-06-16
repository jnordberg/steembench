import {exec, rm, exit} from 'shelljs'

exec('wintersmith build -X') || exit(1)

rm('-r', 'build/scripts')
rm('-r', 'build/styles')

exec('uglifyjs build/bench.js' +
     ' --source-map "content=inline,url=bench.js.map,filename=build/bench.js.map"' +
     ' --compress "dead_code,collapse_vars,reduce_vars,keep_infinity,drop_console,passes=2"' +
     ' -o build/bench.js')
