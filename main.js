const db = Gun({ peers: ['http://localhost:8765/gun', 'https://gundm.herokuapp.com/gun'], localStorage: false });
const messageContainer = document.getElementById('message_container')
db.get('messages').map().once((data) => {
  if (data) {
    const messageBox = document.createElement('div')
    messageBox.textContent = data
    messageContainer.append(messageBox)
  }
})
console.log(db.get('messages'))
const getMessage = document.getElementById('get_message')
document.getElementById('my_form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (getMessage.value.trim() !== '') {
    const index = new Date().toISOString()
    db.get('messages').get(index).put(getMessage.value)
    getMessage.value = ''
  }
})


