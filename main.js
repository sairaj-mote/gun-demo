const db = Gun({ peers: ['http://localhost:8765/gun', 'https://gundm.herokuapp.com/gun'] });
const messageContainer = document.getElementById('message_container')
let hasData
db.get('articles').get('recentArticles').map().once((data) => {
  if (data) {
    hasData = JSON.parse(data)
    // received data
  }
})

window.editor = new EditorJS({
  holder: 'editorjs',
  autofocus: true,
  placeholder: 'Let`s write an awesome story!',
  tools: {
    header: {
      class: Header,
      config: {
        placeholder: 'Header'
      }
    },
    list: List,
    image: SimpleImage,
    quote: Quote,
  },
  data: hasData || {
    blocks: [
      {
        type: 'header',
        data: {
          text: '',
          level: 1
        }
      },
    ]
  },
});

document.getElementById('save').addEventListener('click', (e) => {
  const randomInt = 'first'
  editor.save().then((outputData) => {
    db.get('articles').get('recentArticles').set(JSON.stringify(outputData))
  }).catch((error) => {
    console.log('Saving failed: ', error)
  });
})