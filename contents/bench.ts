require('es6-promise').polyfill()
import main from './scripts/main'
window.addEventListener('DOMContentLoaded', () => {
    main().catch((error) => {
        console.error('Could not start application', error)
    })
})
