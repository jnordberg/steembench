
import * as d3 from 'd3'

const testAccount = 'almost-digital'

const benchCalls = [
    {name: 'get_api_by_name', params: [1, 'get_api_by_name', ['database_api', 'follow_api']]},
    {name: 'get_dynamic_global_properties', params: [0, 'get_dynamic_global_properties', []]},
    {name: 'get_follow_count', params: [5, 'get_follow_count', [testAccount]]},
    {name: 'get_discussions_by_blog', params: [0, 'get_discussions_by_blog', [{'tag': testAccount, 'limit': 5}]]},
]

const defaultNodes = [
    'wss://steemd.steemit.com',
    'wss://node.steem.ws',
    'wss://seed.bitcoiner.me',
    'wss://gtg.steem.house:8090',
    'wss://this.piston.rocks',
]

async function openSocket(address: string, timeout: number = 5000) {
    return new Promise<WebSocket>((resolve, reject) => {
        const timer = setTimeout(() => { reject(new Error('Timed out')) }, timeout)
        const socket = new WebSocket(address)
        socket.onopen = () => {
            clearTimeout(timer)
            resolve(socket)
        }
        socket.onclose = () => {
            clearTimeout(timer)
            reject(new Error('Unable to connect, see console for details'))
        }
    })
}

async function rpcCall(socket: WebSocket, request: any, timeout: number = 5000) {
    return new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => { reject(new Error('Timed out')) }, timeout)
        socket.onmessage = (message) => {
            clearTimeout(timer)
            const response = JSON.parse(message.data)
            if (response.id !== request.id) {
                reject(new Error(`Response id mismatch, expected ${ request.id } got ${ response.id }`))
                return
            }
            if (response.error) {
                const data = response.error.data || {message: 'unknown'}
                reject(new Error(`Response error: ${ data.message }`))
                return
            }
            resolve(response.result)
        }
        socket.send(JSON.stringify(request))
    })
}

interface TimeResult<T> { time: number, value: T }

function timePromise<T>(promise: Promise<T>) {
    return new Promise<TimeResult<T>>((resolve, reject) => {
        const start = performance.now()
        promise.then((value) => {
            const time = performance.now() - start
            resolve({time, value})
        }).catch(reject)
    })
}

interface BenchResult<T> extends TimeResult<T> {
    timestamp: number
    error?: Error
}
interface BenchResults { [name: string]: BenchResult<any> }

async function benchNode(address: string) {
    let socket: WebSocket
    let results: BenchResults = {}

    const timestamp = performance.now()
    try {
        const {value, time} = await timePromise(openSocket(address))
        socket = value
        results['connect'] = {time, timestamp, value: null}
    } catch (error) {
        results['connect'] = {time: -1, timestamp, value: null, error: error}
        for (const {name, params} of benchCalls) {
            results[name] = results['connect']
        }
        return results
    }

    let id = 0
    for (const {name, params} of benchCalls) {
        const timestamp = performance.now()
        try {
            const call = {id: ++id, method: 'call', params}
            const {value, time} = await timePromise(rpcCall(socket, call))
            results[name] = {time, value, timestamp}
        } catch (error) {
            results[name] = {error, time: -1, value: null, timestamp}
        }
    }

    socket.close()

    return results
}

let running = false
async function run(nodes: string[]) {
    let results: {[node: string]: BenchResults[]} = {}

    let resultKeys = benchCalls.map((item) => item.name)
    resultKeys.unshift('connect')

    const infoKeys = ['time', 'head_block_number']
    const headingsMap = {
        'head_block_number': 'block#',
    }
    let headings = ['node'].concat(infoKeys).concat(resultKeys).concat(['score'])

    let table = d3.select('#results')
    table.html('')

    let headingSel = table.selectAll('tr').data([0])
    headingSel.enter().append('tr')

    headingSel.selectAll('th').data(headings).enter().append('th')
        .text((d) => headingsMap[d] || d)
        .attr('class', (d) => {
            if (infoKeys.indexOf(d) !== -1) {
                return 'info ' + d
            }
            if (resultKeys.indexOf(d) !== -1) {
                return 'result ' + d
            }
            return d
        })

    const lastError = (d: BenchResult<any>[]) => d[d.length-1].error

    while (running) {
        for (const node of nodes) {
            try {
                const result = await benchNode(node)
                if (!results[node]) results[node] = []
                results[node].push(result)
            } catch (error) {
                console.error(`Unable to bench: ${ node }`, error)
                continue
            }
            if (!running) break
            let data = Object.keys(results).map((node) => {
                const result: BenchResult<any>[][] = d3.zip.apply(null, results[node].map((r) => d3.permute(r, resultKeys)))
                let info = result[2].sort((a, b) => b.timestamp - a.timestamp)[0].value
                let score = 0
                if (!info) {
                    info = {}
                    for (const key of infoKeys) {
                        info[key] = 'n/a'
                    }
                } else {
                    for (const r of result) {
                        const times = r.filter((d) => d.error == null).map((d) => d.time)
                        if (times.length > 0) {
                            score += Math.max(0, 500 - d3.median(times))
                        }
                        score *= times.length / r.length
                    }
                }
                return {node, result, info, score}
            })

            let rowSel = table.selectAll('tr').data(data, (d) => d.node)
            rowSel.enter().append('tr').append('td')
                .classed('node', true)
                .text((d) => d.node)

            let infoSel = rowSel.selectAll('td.info').data((d) => d3.permute(d.info, infoKeys))
            infoSel.enter().append('td').classed('info', true)
            infoSel.text((d) => String(d))

            let resultSel = rowSel.selectAll('td.result').data((d) => d.result)
            resultSel.enter().append('td').classed('result', true)
            resultSel.filter((d) => lastError(d) != null)
                .classed('error', true)
                .attr('data-error', (d) => lastError(d).message)
            resultSel.text((d) => {
                if (lastError(d) != null) {
                    return 'error'
                }
                return Math.round(d3.mean(d.map((d) => d.time))) + 'ms'
            })

            let scoreSel = rowSel.selectAll('td.score').data((d) => [d.score])
            scoreSel.enter().append('td').classed('score', true)
            scoreSel.text((d) => Math.round(d))

            rowSel.sort((a, b) => b.score - a.score)
            rowSel.filter((d) => d.node == node)
                .transition().duration(1000)
                .styleTween('background', () => d3.interpolateLab('#FFF6D2', 'white'))
        }
    }
}

export default async function main() {
    const textarea = document.getElementById('nodes') as HTMLTextAreaElement
    textarea.value = defaultNodes.join('\n')

    const button = document.getElementById('start') as HTMLButtonElement

    const start = () => {
        const nodes = textarea.value.split('\n').filter((line) => line.trim().length > 0)
        button.textContent = 'Stop'
        document.documentElement.classList.add('running')
        running = true
        run(nodes).catch((error) => {
            console.error('Could not run benchmark', error)
        })
    }

    const stop = () => {
        document.documentElement.classList.remove('running')
        button.textContent = 'Start'
        running = false
    }

    button.addEventListener('click', (event) => {
        event.preventDefault()
        if (running) { stop() } else { start() }
    })
}
