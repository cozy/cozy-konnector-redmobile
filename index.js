const moment = require('moment')

const {log, BaseKonnector, addData, filterData, saveFiles, request} = require('cozy-konnector-libs')

const rq = request({
  cheerio: true,
  json: false,
  jar: true,
  // debug: true,
  headers: {}
})

module.exports = new BaseKonnector(function fetch (fields) {
  return getToken()
  .then(token => logIn(token, fields))
  .then(() => fetchBillingInfo())
  .then($ => parsePage($))
  .then(entries => saveFiles(entries, fields.folderPath, Date.now() + 60 * 1000))
  .then(entries => filterData(entries, 'io.cozy.bills'))
  .then(entries => addData(entries, 'io.cozy.bills'))
})

// Procedure to get the login token
function getToken () {
  log('info', 'Logging in on Sfr RED Website...')
  return rq('https://www.sfr.fr/bounce?target=//www.sfr.fr/sfr-et-moi/bounce.html&casforcetheme=mire-sfr-et-moi&mire_layer')
  .then($ => $('input[name=lt]').val())
}

function logIn (token, fields) {
  return rq({
    method: 'POST',
    url: 'https://www.sfr.fr/cas/login?domain=mire-sfr-et-moi&service=https://www.sfr.fr/accueil/j_spring_cas_security_check#sfrclicid=EC_mire_Me-Connecter',
    form: {
      lt: token,
      execution: 'e1s1',
      _eventId: 'submit',
      username: fields.login,
      password: fields.password,
      identifier: ''
    }
  })
  .then($ => {
    const badLogin = $('#username').length > 0
    if (badLogin) throw new Error('bad login')
  })
  .catch(err => {
    log('info', err.message, 'Error while logging in')
    throw new Error('LOGIN_FAILED')
  })
}

function fetchBillingInfo (requiredFields, bills, data, next) {
  log('info', 'Fetching bill info')
  return rq('https://espace-client.sfr.fr/facture-mobile/consultation')
  .catch(err => {
    log('error', err.message, 'Error while fetching billing info')
    throw err
  })
}

function parsePage ($) {
  const result = []
  moment.locale('fr')
  const baseURL = 'https://espace-client.sfr.fr'

  const firstBill = $('#facture')
  const firstBillUrl = $('#lien-telecharger-pdf').attr('href')

  if (firstBillUrl) {
    // The year is not provided, but we assume this is the current year or that
    // it will be provided if different from the current year
    let firstBillDate = firstBill.find('tr.header h3').text().substr(17)
    firstBillDate = moment(firstBillDate, 'D MMM YYYY')

    const price = firstBill.find('tr.total td.prix').text()
                                                    .replace('€', '')
                                                    .replace(',', '.')

    const bill = {
      date: firstBillDate,
      amount: parseFloat(price),
      fileurl: `${baseURL}${firstBillUrl}`,
      filename: `${firstBillDate.format('YYYY_MM')}_SfrRed.pdf`,
      vendor: 'SFR RED'
    }

    result.push(bill)
  } else {
    log('info', 'wrong url for first PDF bill.')
  }

  $('#tab tr').each(function each () {
    let date = $(this).find('.date').text()
    let prix = $(this).find('.prix').text()
                                    .replace('€', '')
                                    .replace(',', '.')
    let pdf = $(this).find('.liens a').attr('href')

    if (pdf) {
      date = date.split(' ')
      date.pop()
      date = date.join(' ')
      date = moment(date, 'D MMM YYYY')
      prix = parseFloat(prix)
      pdf = `${baseURL}${pdf}`

      const bill = {
        date,
        amount: prix,
        fileurl: pdf,
        filename: `${date.format('YYYY_MM')}_SfrRed.pdf`
      }

      result.push(bill)
    } else {
      log('info', 'wrong url for PDF bill.')
    }
  })

  log('info', 'Successfully parsed the page')

  return result
}
