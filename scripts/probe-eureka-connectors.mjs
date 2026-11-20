import {fetchEureka,fetchEurostars} from '../lib/eureka-listing.ts';console.log('Eureka',JSON.stringify(await fetchEureka()));console.log('Eurostars',JSON.stringify(await fetchEurostars()));
