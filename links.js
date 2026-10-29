/* The links the page and the guide show. A plain script with no build step: change a value, push, and the page changes for
   every box already printed (the QR code on the box only names the page, never these links). Everything here is public. */
window.SINKO_LINKS = Object.freeze({
  /* The app on the App Store, once it is published there: https://apps.apple.com/app/id<the app's id>
     (App Store Connect, the app's App Information, Apple ID). Empty: the button says "Coming soon". */
  appStore: '',

  /* The app on Google Play, once it is public there (not only on the internal testing track):
     https://play.google.com/store/apps/details?id=bh.ioai.sinko. Empty: the button says "Coming soon". */
  googlePlay: '',

  /* Where people get help: a page, a WhatsApp link (https://wa.me/<number>) or "mailto:name@example.org".
     Empty: the guide's "Get help" button is hidden. */
  help: ''
});
