const http = require("http")
const server = http.createServer((req, res) => {
    res.writeHead(200)
    res.write("discord illegal")
    res.end()
}).listen(8080)

server.on("listening", () => {
    console.log(`HTTP server listening on port 8080`)
})

const Discord = require("./discord.js-self/src")
const fetch = require("node-fetch")
const axios = require("axios")
const fs = require("fs")
const config = require("./config.json")
const tokens = require("./tokens.json")
const coins = require("./coins.json")

Number.prototype.f = function(p) {
  let parts
  if (p) {
    parts = this.toFixed(p).split(".")
  } else {
    parts = this.toString().split(".")
  }
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  return parts.join(".")
}

let pools
let listening = {
  active: false,
  pool: null,
  channel: null,
  distributor: null
}

let chartPeriodMsgs = {}
const periodMapping = {
  "🇩": 1440,
  "4️⃣": 240,
  "🇭": 60,
  "5️⃣": 5,
  "1️⃣": 1
}

getPools()
const client = new Discord.Client()
client.login(config.token)

client.on("ready", () => {
  console.log("bot ready")
  setInterval(async () => {
    const tokenValues = await Promise.all(Object.keys(pools).map(getValue))
    let totalPooled = 0
    for (let i = 0; i < Object.keys(pools).length; i++) {
      let poolTotal = 0
      const tokenValue = tokenValues[i] ? tokenValues[i].priceUSD : 0
      for (const user in pools[Object.keys(pools)[i]].users) {
        poolTotal += tokenValue * pools[Object.keys(pools)[i]].users[user]
      }
      totalPooled += poolTotal
    }
    client.user.setActivity(`over $${totalPooled.toFixed(2)}`, { type: 'WATCHING' }).catch(console.log)
  }, 30000)
})

client.on("message", async (msg) => {
  if (msg.guild.id === config.guildId) {
    if (msg.author.id === config.tipccId) {
      const senderRegex = new RegExp("(?<=<@!{0,})(\\d+)(?=> sent (<@!{0,}" + client.user.id + "> \\*\\*))")
      let sender = msg.content.match(senderRegex, "g")
      if (sender) { //tipping to bot
        sender = sender[0]
        const amount = msg.content.match(/(?<=\*\*)[\d\S\., ]+(?=\*\*)/g)[0].split(" ")[0].replace(/,/g, "")
        const backCurrency = msg.content.match(/(?<=\*\*)[\d\S\., ]+(?=\*\*)/g)[0].split(" ").slice(1).join(" ")
        const currency = msg.content.match(/(?<=:)\w+/g)[0].toLowerCase()
        if (Object.keys(pools).includes(currency) && !pools[currency].locked) {
          getPools()
          if (pools[currency].users[sender]) {
            pools[currency].users[sender] += +amount
          } else {
            pools[currency].users[sender] = +amount
          }
          writePools()
          msg.react("✅")
        } else if (listening.active && listening.distributor === sender) { //distribution
          getPools()
          listening.active = false
          total = 0
          for (const user in pools[listening.pool].users) {
            total += +pools[listening.pool].users[user]
          }
          const value = (await getValue(currency)).priceUSD
          const payoutEmbed = new Discord.MessageEmbed().setColor("#30cfff").setTitle(`${listening.pool.toUpperCase()} Payout Complete`).setDescription(`Total: **${(+amount).f()} ${currency.toUpperCase()}** ($${((+amount)*value).f(2)})`)
          const users = []
          const values = []
          const shares = []
          for (const user in pools[listening.pool].users) {
            msg.channel.send(`$tip <@${user}> ${amount * (pools[listening.pool].users[user] / total)} ${currency}`)
            users.push(`<@${user}>`)
            values.push(`**${(amount * (pools[listening.pool].users[user] / total)).toFixed(8)} ${currency.toUpperCase()}** ($${((amount * (pools[listening.pool].users[user] / total)) * value).toFixed(2)})`)
            shares.push(((pools[listening.pool].users[user] / total) * 100).toFixed(2) + "%")
            await new Promise(r => {setTimeout(r, 5000)})
          }
          payoutEmbed.addFields(
            {name: "User", value: users.join("\n"), inline: true},
            {name: `Payout (${currency.toUpperCase()})`, value: values.join(`\n`), inline: true},
            {name: "Pool Share", value: shares.join("\n"), inline: true}
          )
          const channelD = await client.channels.cache.get(listening.channel)
          channelD.send(payoutEmbed)
          delete pools[listening.pool]
          listening.pool = null
          listening.channel = null
          listening.distributor = null
          writePools()
        } else {
          msg.react("😡")
          msg.channel.send(`$tip <@${sender}> ${amount} ${backCurrency}`)
        }
      } else if (msg.embeds[0] && msg.embeds[0].description && msg.embeds[0].description.match(new RegExp("(:grey_question:) (<@!{0,}" + client.user.id + ">)(, this tip)", "g"))) { //big tips
        await new Promise(r => {setTimeout(r, 2000)})
        msg.channel.send("yes")
      }
    } else if (msg.content.startsWith("!pool ") || msg.content.startsWith("!p ")) {
      const args = msg.content.split(" ").slice(1)
      if (args[0] === "create" || args[0] === "+") { //creation of pool
        if (args[1]) {
          args[1] = args[1].toLowerCase()
          if (!Object.keys(pools).includes(args[1])) {
            getPools()
            pools[args[1]] = {}
            pools[args[1]].users = {}
            pools[args[1]].locked = false
            pools[args[1]].withdrawer = null
            writePools()
            msg.react("✅")
          } else {
            msg.react("😡")
          }
        } else {
          msg.react("😡")
        }
      } else if (args[0] == "destroy" || args[0] === "-") {
        if (args[1]) {
          args[1] = args[1].toLowerCase()
          if (Object.keys(pools).includes(args[1])) {
            if (!pools[args[1]].locked) {
              const channelD = await client.channels.cache.get(config.tipChannel)
              for (const user in pools[args[1]].users) {
                await channelD.send(`$tip <@${user}> ${pools[args[1]].users[user]} ${args[1]}`)
                await new Promise(r => {setTimeout(r, 5000)})
              }
              delete pools[args[1]]
              writePools()
              msg.react("✅")
            } else {
              msg.react("😡")
            }
          } else {
            msg.react("😡")
          }
        } else {
          msg.react("😡")
        }
      } else if (args[0] === "withdraw" || args[0] === "^") { //withdraw all of pool for swap
        if (config.withdrawWhitelist.includes(msg.author.id)) {
          if (args[1]) {
            args[1] = args[1].toLowerCase()
            getPools()
            if (Object.keys(pools).includes(args[1])) {
              if (!pools[args[1]].locked) {
                if (Object.keys(pools[args[1]].users).length > 0) {
                  const channelD = await client.channels.cache.get(config.tipChannel)
                  await channelD.send(`$tip <@${msg.author.id}> all ${args[1]}`)
                  pools[args[1]].locked = true
                  pools[args[1]].withdrawer = msg.author.id
                  writePools()
                  msg.react("✅")
                } else {
                  msg.react("😡")
                }
              } else {
                
              }
            } else {
              msg.react("😡")
            }
          } else {
            msg.react("😡")
          }
        } else {
          msg.react("😡")
        }
      } else if (args[0] === "distribute" || args[0] === "=") { //make bot listen for tips
        if (args[1]) {
          args[1] = args[1].toLowerCase()
          if (Object.keys(pools).includes(args[1]) && Object.keys(pools[args[1]].users).length > 0) {
            listening.active = true
            listening.pool = args[1]
            listening.channel = msg.channel.id
            listening.distributor = msg.author.id
            msg.react("✅")
          } else {
            msg.react("😡")
          }
        } else {
          msg.react("😡")
        }
      } else if (args[0] === "status" || args[0] === "?") { //show pool status
        if (args[1]) {
          args[1] = args[1].toLowerCase()
          getPools()
          if (Object.keys(pools).includes(args[1])) {
            let total = 0
            const users = []
            const values = []
            const shares = []

            for (const user in pools[args[1]].users) {
              total += +pools[args[1]].users[user]
            }
            let tokenValue = await getValue(args[1])
            let isToken = Boolean(tokenValue.id)
            tokenValue = tokenValue ? tokenValue.priceUSD : null

            const sorted = Object.keys(pools[args[1]].users).sort((a, b) => {
              if (pools[args[1]].users[a] < pools[args[1]].users[b]) {
                return 1
              } else if (pools[args[1]].users[a] > pools[args[1]].users[b]) {
                return -1
              }
              return 0
            })

            for (const user of sorted) {
              users.push(`${msg.author.id === user ? "➤ " : ""}<@${user}>`)
              values.push(`**${pools[args[1]].users[user].f()} ${args[1].toUpperCase()}**${(tokenValue ? ` ($${(tokenValue * pools[args[1]].users[user]).toFixed(2)})` : "")}`)
              shares.push(`${((pools[args[1]].users[user] / total) * 100).toFixed(2)}%`)
            }

            const statusEmbed = new Discord.MessageEmbed().setColor("#30cfff").setTitle(`${pools[args[1]].locked ? "🔒" : "🔓"} ${args[1].toUpperCase()} Pool Status`).setDescription(`**${(+total).f()} total ${args[1].toUpperCase()}**${(tokenValue ? ` ($${(tokenValue * +total).toFixed(2)})` : "")} in pool${isToken ? `\nAfter Price Impact: $${(await getActualOutput(args[1], total)).toFixed(2)}` : ""}${pools[args[1]].locked ? `\nWithdrawer: <@${pools[args[1]].withdrawer}>` : ""}`)
            if (total > 0) {
              statusEmbed.addFields(
                {name: "User", value: users.join("\n"), inline: true},
                {name: "Value", value: values.join("\n"), inline: true},
                {name: "Pool Share", value: shares.join("\n"), inline: true}
              )
            }
            msg.channel.send(statusEmbed)
          } else {
            msg.react("😡")
          }
        } else {
          msg.react("😡")
        }
      } else if (args[0] === "list" || args[0] === "%") {
        poolsList(msg)
      } else if (args[0] === "exit" || args[0] === "<") { //refund a user's pool share
        if (args[1]) {
          args[1] = args[1].toLowerCase()
          getPools()
          if (Object.keys(pools).includes(args[1])) {
            if (pools[args[1]].users[msg.author.id]) {
              if (!pools[args[1]].locked) {
                const channelD = await client.channels.cache.get(config.tipChannel)
                await channelD.send(`$tip <@${msg.author.id}> ${pools[args[1]].users[msg.author.id]} ${args[1]}`)
                delete pools[args[1]].users[msg.author.id]
                writePools()
                msg.react("✅")
              } else {
                msg.react("😡")
              }
            } else {
              msg.react("😡")
            }
          } else {
            msg.react("😡")
          }
        } else {
          msg.react("😡")
        }
      } else if (args[0] === "check" || args[0] === "#") { //command to show bals
        getPools()
        msg.channel.send(`\`\`\`\n$bals ${Object.keys(pools).join(", ")}\n\`\`\``)
      } else if (args[0] === "value" || args[0] === "$") { //get value of token
        if (args[1]) {
          msg.channel.startTyping()
          const token = await getValue(args[1])
          const ethPrice = await getETHPrice()
          const sentMsg = await msg.channel.send(createPriceEmbed(token, ethPrice, /*token?.id*/ false ? await getChartURL(args[1], 50, 240) : null))
          msg.channel.stopTyping()
          // if (token?.id) {
          //   ["🇩", "4️⃣", "🇭", "5️⃣", "1️⃣"].map(r => sentMsg.react(r))
          //   chartPeriodMsgs[sentMsg.id] = {
          //     current: "4️⃣",
          //     token: token,
          //     ethPrice: ethPrice,
          //     symbol: args[1],
          //     author: msg.author.id,
          //     timeout: setTimeout(() => {
          //       delete chartPeriodMsgs[sentMsg.id]
          //       sentMsg.reactions.removeAll()
          //     }, 60000)
          //   }
          // }
        } else {
          msg.react("😡")
        }
      } else if (args[0] === "uadd" || args[0] === "?+") {
        if (args[1]) {
          args[1] = args[1].toLowerCase()
          getPools()
          if (Object.keys(pools).includes(args[1])) {
            if (pools[args[1]].locked) {
              if (pools[args[1]].withdrawer == msg.author.id) {
                if (args[2] && args[2].match(/<@!{0,}(\d+)>/g)) {
                  if (args[3] && +args[3]) {
                    const id = args[2].match(/(?<=<@!{0,})(\d+)(?=>)/g)[0]
                    if (pools[args[1]].users[id]) {
                      if ((pools[args[1]].users[id] + +args[3]) > 0) {
                        pools[args[1]].users[id] += +args[3]
                        writePools()
                        msg.react("✅")
                      } else if ((pools[args[1]].users[id] + +args[3]) == 0) {
                        delete pools[args[1]].users[id]
                        writePools()
                        msg.react("✅")
                      } else {
                        msg.react("😡")
                      }
                    } else {
                      if (+args[3] > 0) {
                        pools[args[1]].users[id] = +args[3]
                        writePools()
                        msg.react("✅")
                      } else {
                        msg.react("😡")
                      }
                    }
                  } else {
                    msg.react("😡")
                  }
                } else {
                  msg.react("😡")
                }
              } else {
                msg.react("😡")
              }
            } else {
              msg.react("😡")
            }
          } else {
            msg.react("😡")
          }
        } else {
          msg.react("😡")
        }
      } else if (args[0] == "log") {
        getPools()
        await client.channels.cache.get(config.logChannel).send(JSON.stringify(pools))
        msg.react("✅")
      } else if (args[0] == "help") {
        const helpEmbed = new Discord.MessageEmbed().setColor("#30cfff").setTitle(`Pools Help`).addFields(
          {name: "create (+)", value: "Creates a new unlocked pool\n**Usage**: !pool create <pool name>", inline: true},
          {name: "destroy (-)", value: "Destroys an unlocked pool, refunding its poolers\n**Usage**: !pool destroy <pool name>", inline: true},
          {name: "​", value: "​", inline: true},
          {name: "list (%)", value: "Shows the status of all pools\n**Usage**: !pool list | !pools", inline: true},
          {name: "check (#)", value: "Gives a command to check your tip.cc balances for all pooled tokens\n**Usage**: !pool check", inline: true},
          {name: "​", value: "​", inline: true},
          {name: "status (?)", value: "Shows the list of contributions to a pool\n**Usage**: !pool status <pool name>", inline: true},
          {name: "exit (<)", value: "Refunds all your contributions to an unlocked pool\n**Usage**: !pool exit <pool name>", inline: true},
          {name: "​", value: "​", inline: true},
          {name: "withdraw (^)", value: "Withdraws all tokens from a pool to a withdrawer, locking the pool\n**Usage**: !pool withdraw <pool name>", inline: true},
          {name: "distribute (=)", value: "Distributes a coin to poolers according to the weight of a locked pool\n**Usage**: !pool distribute <pool name>, then tip the coins to distribute to the bot", inline: true},
          {name: "​", value: "​", inline: true},
          {name: "uadd (?+)", value: "Unofficially adds tokens to a locked pool (ex. the withdrawer taking funds from Roll)\n**Usage**: !pool uadd <pool name> <user> <amount>", inline: true},
          
        )
        msg.channel.send(helpEmbed)
      }
    } else if (msg.content == "!pools" || msg.content == "!ps") {
      poolsList(msg)
    }
  }
})

client.on("messageReactionAdd", async (reaction, user) => {
  if (Object.keys(chartPeriodMsgs).includes(reaction.message.id) && user.id != client.user.id && user.id == chartPeriodMsgs[reaction.message.id].author && reaction.emoji.name != chartPeriodMsgs[reaction.message.id].current && ["🇩", "4️⃣", "🇭", "5️⃣", "1️⃣"].includes(reaction.emoji.name)) {
    chartPeriodMsgs[reaction.message.id].current = reaction.emoji.name
    clearTimeout(chartPeriodMsgs[reaction.message.id].timeout)
    chartPeriodMsgs[reaction.message.id].timeout = setTimeout(() => {
      delete chartPeriodMsgs[reaction.message.id]
      reaction.message.reactions.removeAll()
    }, 60000)
    reaction.message.react("⌛")
    await reaction.message.edit(createPriceEmbed(chartPeriodMsgs[reaction.message.id].token, chartPeriodMsgs[reaction.message.id].ethPrice, await getChartURL(chartPeriodMsgs[reaction.message.id].symbol, 50, periodMapping[reaction.emoji.name])))
    reaction.message.reactions.cache.get("⌛").remove()
  }
})

client.on("messageReactionRemove", async (reaction, user) => {
  if (Object.keys(chartPeriodMsgs).includes(reaction.message.id) && user.id != client.user.id && user.id == chartPeriodMsgs[reaction.message.id].author && reaction.emoji.name != chartPeriodMsgs[reaction.message.id].current && ["🇩", "4️⃣", "🇭", "5️⃣", "1️⃣"].includes(reaction.emoji.name)) {
    chartPeriodMsgs[reaction.message.id].current = reaction.emoji.name
    clearTimeout(chartPeriodMsgs[reaction.message.id].timeout)
    chartPeriodMsgs[reaction.message.id].timeout = setTimeout(() => {
      delete chartPeriodMsgs[reaction.message.id]
      reaction.message.reactions.removeAll()
    }, 60000)
    reaction.message.react("⌛")
    await reaction.message.edit(createPriceEmbed(chartPeriodMsgs[reaction.message.id].token, chartPeriodMsgs[reaction.message.id].ethPrice, await getChartURL(chartPeriodMsgs[reaction.message.id].symbol, 50, periodMapping[reaction.emoji.name])))
    reaction.message.reactions.cache.get("⌛").remove()
  }
})

function getPools() {
  pools = JSON.parse(fs.readFileSync(`./pools.json`));
}

function writePools() {
  fs.writeFileSync("./pools.json", JSON.stringify(pools))
  // client.channels.cache.get(config.logChannel).send(JSON.stringify(pools))
}

async function getValue(token) {
  if (coins[token.toUpperCase()]) {
    token = token.toUpperCase()
    const price = await axios(`https://api.coingecko.com/api/v3/simple/price?ids=${coins[token]}&vs_currencies=usd,eth`)
    return {priceUSD: price.data[coins[token]].usd, priceETH: price.data[coins[token]].eth, name: coins[token][0].toUpperCase() + coins[token].slice(1)}
  } else {
    if (token == token.toLowerCase() || token == token.toUpperCase()) {
      token = token.toUpperCase()
    }
    
    // Get Uniswap value
    const [eth, id] = await Promise.all([
        getETHPrice(),
        tokens[token] ? axios({
          url: "https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v2",
          method: "POST",
          headers: { 
              "content-type": "application/json"
          },
          data: {
              operationName: "tokens",
              query: `query tokens($id: String) {
                asSymbol: tokens(where: {id: $id}) {
                  id
                  name
                }
              }`,
              variables: {
                  id: tokens[token]
              }
          }
      }) : axios({
            url: "https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v2",
            method: "POST",
            headers: { 
                "content-type": "application/json"
            },
            data: {
                operationName: "tokens",
                query: `query tokens($symbol: String) {
                  asSymbol: tokens(where: {symbol: $symbol}, orderBy: tradeVolumeUSD, orderDirection: desc) {
                    id
                    name
                  }
                }`,
                variables: {
                    symbol: token
                }
            }
        })
    ])

    const tokenData = id.data?.data?.asSymbol[0]
    if (!tokenData) return
    const tokenId = tokenData.id
    const tokenName = tokenData.name
    let tokenPriceETH = await axios({
      url: "https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v2",
      method: "POST",
      headers: { 
          "content-type": "application/json"
      },
      data: {
          operationName: "pairs",
          query: `query pairs($id: String) {
            asId: pairs(where: {token0: $id, token1: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"}) {
              id
              token1Price
              reserve0
              reserve1
              volumeUSD
            }
          }`,
          variables: {
              id: (tokens[token] ? tokens[token] : tokenId)
          }
      }
    })
    if (tokenPriceETH.data?.data?.asId[0]) {
      return {priceETH: +tokenPriceETH.data.data.asId[0].token1Price, priceUSD: tokenPriceETH.data.data.asId[0].token1Price * eth, name: tokenName, id: tokenId, tokenReserve: +tokenPriceETH.data.data.asId[0].reserve0, ethReserve: +tokenPriceETH.data.data.asId[0].reserve1, pairId: tokenPriceETH.data.data.asId[0].id, volumeUSD: +tokenPriceETH.data.data.asId[0].volumeUSD}
    } else {
      tokenPriceETH = await axios({
        url: "https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v2",
        method: "POST",
        headers: { 
            "content-type": "application/json"
        },
        data: {
            operationName: "pairs",
            query: `query pairs($id: String) {
              asId: pairs(where: {token0: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", token1: $id}) {
                id
                token0Price
                reserve0
                reserve1
                volumeUSD
              }
            }`,
            variables: {
                id: (tokens[token] ? tokens[token] : tokenId)
            }
        }
      })
      if (tokenPriceETH.data?.data?.asId[0]) {
        return {priceETH: +tokenPriceETH.data.data.asId[0].token0Price, priceUSD: tokenPriceETH.data.data.asId[0].token0Price * eth, name: tokenName, id: tokenId, tokenReserve: +tokenPriceETH.data.data.asId[0].reserve1, ethReserve: +tokenPriceETH.data.data.asId[0].reserve0, pairId: tokenPriceETH.data.data.asId[0].id, volumeUSD: +tokenPriceETH.data.data.asId[0].volumeUSD}
      } else {
        return
      }
    }
  }
}

async function getActualOutput(token, amount) {
  const value = await getValue(token)
  return ((amount * value.ethReserve * 0.997) / (value.tokenReserve + (amount * 0.997))) * await getETHPrice()
}

async function getETHPrice() {
  return (await axios("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd")).data.ethereum.usd
}

async function getOHLC(token, count, period) {
  if (token == token.toLowerCase() || token == token.toUpperCase()) {
    token = token.toUpperCase()
  }
  let tokenId = tokens[token] ? tokens[token] : (await axios({
    url: "https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v2",
    method: "POST",
    headers: { 
      "content-type": "application/json"
    },
    data: {
      operationName: "tokens",
      query: `query tokens($symbol: String) {
        asSymbol: tokens(where: {symbol: $symbol}, orderBy: tradeVolumeUSD, orderDirection: desc) {
          id
          name
        }
      }`,
      variables: {
        symbol: token
      }
    }
  })).data?.data?.asSymbol[0]?.id
  
  const query = `{
    ethereum(network: ethereum) {
      dexTrades(options: {limit: ${count + 1}, desc: "timeInterval.minute"}, 
        protocol: {is: "Uniswap v2"},
        buyCurrency: {is: "${tokenId}"}, 
        sellCurrency: {is: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"}) {
        timeInterval {
          minute(count: ${period})
        }
        buyCurrency {
          symbol
        }
        sellCurrency {
          symbol
        }
        trades: count
        maximum_price: price(calculate: maximum)
        minimum_price: price(calculate: minimum)
        open_price: minimum(of: block, get: price)
        close_price: maximum(of: block, get: price)
      }
    }
  }`

  const ohlc = (await axios({
    url: "https://graphql.bitquery.io/",
    method: "POST",
    headers: {"Content-Type": "application/json"},
    data: JSON.stringify({
      query
    })
  })).data.data.ethereum.dexTrades.map(c => ({
    t: new Date(c.timeInterval.minute + " UTC").getTime(),
    o: +c.open_price,
    h: c.maximum_price,
    l: c.minimum_price,
    c: +c.close_price
  }))

  ohlc.reverse()
  const ohlcFilled = [] 

  for (let i = count; i > 0; i--) {
    const fixedCandleTime = ((t) => (t - t % (period * 60 * 1000)) - ((period * 60 * 1000) * i))(Date.now())
    for (let j = 0; j < ohlc.length; j++) {
      if (ohlc[j].t <= fixedCandleTime && (!ohlc[j+1] || ohlc[j+1].t > fixedCandleTime)) {
        ohlcFilled.push({...ohlc[j], t: fixedCandleTime})
        break
      }
    }
  }

  return ohlcFilled
}

async function getChartURL(token, count, period) {
  const ohlc = await getOHLC(token, count, period)
  const data = {
    type: 'bar',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Green Body',
          backgroundColor: '#26A69A',
          minBarLength: 3,
          data: [
            
          ],
        },
        {
          label: 'Green Wick',
          backgroundColor: '#26A69A',
          barThickness: 3,
          data: [
            
          ]
        },
        {
          label: 'Red Body',
          backgroundColor: '#EF5350',
          minBarLength: 2,
          data: [
            
          ],
        },
        {
          label: 'Red Wick',
          backgroundColor: '#EF5350',
          barThickness: 3,
          data: [
            
          ],
        }
      ],
    },
    options: {
      responsive: true,
      legend: {
        display: false
      },
      title: {
        display: true,
        text: `${token.toUpperCase()} ${period}`,
        fontColor: "white",
        fontSize: 36,
        fontStyle: "normal",
      },
      scales: {
        xAxes: [{
          stacked: true,
          ticks: {
            fontColor: "#fff",
            fontSize: 26
          }
        }],
        yAxes: [{
          position: "right",
          gridLines: {
            display: true,
            color: "#3d4b6b"
          },
          ticks: {
            fontColor: "#fff",
            fontSize: 26
          }
        }]
      },
      layout: {
        padding: {
          left: 20,
          bottom: 10,
          right: 10,
          top: 5
        }
      }
    },
  }

  const counter = count
  for (const candle of ohlc) {
    data.data.labels.push(count)
    data.data.datasets[0].data.push(candle.c >= candle.o ? [candle.o, candle.c] : [])
    data.data.datasets[1].data.push(candle.c >= candle.o ? [candle.l, candle.h] : [])
    data.data.datasets[2].data.push(candle.c < candle.o ? [candle.c, candle.o] : [])
    data.data.datasets[3].data.push(candle.c < candle.o ? [candle.l, candle.h] : [])
    count--
  }

  return fetch("https://quickchart.io/chart/create", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({backgroundColor: "#141823", height: 600, width: 1000, chart: data})
  }).then(res => res.json()).then(res => res.url)
}

function createPriceEmbed(token, ethPrice, chartURL) {
  const priceEmbed = new Discord.MessageEmbed().setColor("#30cfff")
  
  if (token) {
    priceEmbed.setTitle(`${token.name} Info`).addFields(
      {name: "USD Price", value: `$${(+token.priceUSD).f(4)}`, inline: true},
      {name: "ETH Price", value: `${(+token.priceETH).f(6)} ETH`, inline: true}
    )
    if (token.id) {
      priceEmbed.addFields(
        {name: "Liquidity", value: `$${(+(token.ethReserve * 2 * ethPrice)).f(2)}`, inline: true},
        {name: "Volume", value: `$${token.volumeUSD.f(2)}`, inline: true},
        {name: "Vol/Liq", value: `${(token.volumeUSD/(token.ethReserve * 2 * ethPrice)).f(6)}`, inline: true},
        {name: "Contract", value: `[${token.id}](https://uniswap.info/token/${token.id})`},
        {name: "Pair", value: `[${token.pairId}](https://uniswap.info/pair/${token.pairId})`},
        {name: "\u200b", value: `**[Buy](https://app.uniswap.org/#/swap?outputCurrency=${token.id})**`, inline: true},
        {name: "\u200b", value: `**[Sell](https://app.uniswap.org/#/swap?inputCurrency=${token.id})**`, inline: true},
        {name: "\u200b", value: `**[DexTools](https://www.dextools.io/app/uniswap/pair-explorer/${token.pairId})**`, inline: true}
      ).setImage(chartURL)
    }
  } else {
    priceEmbed.setTitle(`No Token Found`)
  }
  return priceEmbed
}


async function poolsList(msg) {
  const listEmbed = new Discord.MessageEmbed().setColor("#30cfff")
  getPools()
  const poolList = Object.keys(pools).map(pool => (pools[pool].locked ? "🔒" : "🔓"))
  const totals = []
  const shares = []
  let totalPooled = 0
  let userPooledTotal = 0
  const tokenValues = await Promise.all(Object.keys(pools).map(getValue))
  let tokenIndex = 0
  for (const pool in pools) {
    let userShare
    let total = 0
    const tokenValue = tokenValues[tokenIndex] ? tokenValues[tokenIndex].priceUSD : null
    for (const user in pools[pool].users) {
      total += +pools[pool].users[user]
      if (user === msg.author.id) {
        userShare = +pools[pool].users[user]
      }
    }
    totalPooled += tokenValue ? (tokenValue * total) : 0
    userPooledTotal += (tokenValue ? (tokenValue * total) : 0) * (userShare ? ((userShare / total)) : 0)
    userShare = `**${(userShare ? ((userShare / total) * 100).toFixed(2) + "%" : "N/A")}** ($${((tokenValue ? (tokenValue * total) : 0) * (userShare ? ((userShare / total)) : 0)).toFixed(2)})`
    totals.push(`**${total.toLocaleString()} ${pool.toUpperCase()}**${(tokenValue ? ` ($${(tokenValue * total).toFixed(2)})` : "")}`)
    shares.push(userShare)
    tokenIndex++
  }
  if (poolList.length > 0) {
    listEmbed.addFields(
      {name: "\u200b", value: poolList.join("\n"), inline: true},
      {name: "Total Pooled", value: totals.join("\n"), inline: true},
      {name: "Your Pool Share", value: shares.join("\n"), inline: true}
    ).setTitle(`All Pools${(totalPooled ? ` ($${totalPooled.toFixed(2)})` : "")}`).setDescription(`Your Total: $${userPooledTotal.toFixed(2)}`)
  } else {
    listEmbed.setDescription("No pools")
  }
  msg.channel.send(listEmbed)
}