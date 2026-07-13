# Discovery

Tool web statico per creare una scheda strategica A4 e stamparla in PDF.

## Cosa sono i test automatici
I test automatici sono controlli eseguiti da script che simulano l'uso reale dell'app e verificano che le funzioni chiave continuino a funzionare dopo ogni modifica.

In questo progetto i test automatici verificano:
- layout verticale senza pannello Live a destra
- blocco Qualita in fondo alla form
- generazione documento A4 con dati minimi validi
- persistenza dati dopo reload
- struttura completa delle Metriche con etichette semplificate

## Avvio locale
- Installazione dipendenze: npm install
- Avvio app locale: npm run dev
- URL: http://127.0.0.1:4173

## Test automatici
- Esecuzione completa: npm test
- Modalita UI Playwright: npm run test:ui
- Modalita con browser visibile: npm run test:headed
- Report HTML test: npm run test:report

## Standard di chiusura progetto
Vedi il file [DONE_CRITERIA.md](DONE_CRITERIA.md).
