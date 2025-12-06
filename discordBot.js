const { Client, GatewayIntentBits, Partials } = require('discord.js');

function startDiscordBot(token) {
  if (!token) {
    console.warn('DISCORD_TOKEN이 설정되지 않아 디스코드 봇이 비활성화되었습니다.');
    return null;
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],
  });

  client.once('ready', () => {
    console.log(`디스코드 봇 로그인: ${client.user.tag}`);
  });

  client.on('messageCreate', (message) => {
    if (message.author.bot) {
      return;
    }

    if (message.content.trim() === '!봇') {
      message.channel
        .send('안녕')
        .catch((error) => console.error('디스코드 메시지 전송 실패:', error));
    }
  });

  client.login(token).catch((error) => {
    console.error('디스코드 봇 로그인 실패:', error);
  });

  return client;
}

module.exports = { startDiscordBot };
