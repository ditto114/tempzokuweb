const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const TARGET_GUILD_ID = '1433396128224907326';

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
      GatewayIntentBits.GuildMembers,
    ],
    partials: [Partials.Channel],
  });

  client.once(Events.ClientReady, () => {
    console.log(`디스코드 봇 로그인: ${client.user.tag}`);
  });

  client.on(Events.MessageCreate, (message) => {
    if (message.author.bot) {
      return;
    }

    if (message.content.trim() === '!다이') {
      const buttonRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('die_penalty')
          .setLabel('다이(패널티 적용)')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('die_review')
          .setLabel('다이(패널티 검토 필요)')
          .setStyle(ButtonStyle.Success)
      );

      message.channel
        .send({ components: [buttonRow] })
        .catch((error) => console.error('디스코드 메시지 전송 실패:', error));
      return;
    }

    if (message.content.trim() === '!봇') {
      const targetGuild = client.guilds.cache.get(TARGET_GUILD_ID);

      if (!targetGuild) {
        message.channel
          .send('서버 정보를 찾을 수 없습니다. 봇이 초대되어 있는지 확인해주세요.')
          .catch((error) => console.error('디스코드 메시지 전송 실패:', error));
        return;
      }

      targetGuild.members
        .fetch()
        .then((members) => {
          const memberLines = members.map((member) => {
            const nickname = member.nickname || member.user.username;
            const roles = member.roles.cache
              .filter((role) => role.id !== targetGuild.id)
              .map((role) => role.name)
              .join(', ');

            const roleLabel = roles || '없음';

            return `ID: ${member.id} / 유저명: ${member.user.username} / 닉네임: ${nickname} / 역할: ${roleLabel}`;
          });

          const response = memberLines.length
            ? `멤버 목록 (총 ${memberLines.length}명):\n` + memberLines.join('\n')
            : '멤버 목록을 불러오지 못했습니다.';

          return message.channel.send(response);
        })
        .catch((error) => {
          console.error('멤버 목록 조회 실패:', error);
          message.channel
            .send('멤버 목록을 불러오는 중 오류가 발생했습니다.')
            .catch((sendError) => console.error('디스코드 메시지 전송 실패:', sendError));
        });
    }
  });

  client.on(Events.InteractionCreate, (interaction) => {
    if (!interaction.isButton()) {
      return;
    }

    if (interaction.customId === 'die_penalty' || interaction.customId === 'die_review') {
      const now = new Date();
      const timeString = now.toLocaleString('ko-KR', {
        timeZone: 'Asia/Seoul',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
      });

      const nickname = interaction.member?.nickname || interaction.user.username;
      const suffix =
        interaction.customId === 'die_penalty'
          ? '패널티 적용'
          : '패널티 검토';

      interaction
        .deferUpdate()
        .then(() =>
          interaction.channel
            .send({ content: `:alarm_clock: ${timeString} :skull_crossbones:${nickname} - ${suffix}` })
            .catch((error) => console.error('디스코드 메시지 전송 실패:', error))
        )
        .catch((error) => console.error('디스코드 버튼 응답 실패:', error));
    }
  });

  client.login(token).catch((error) => {
    console.error('디스코드 봇 로그인 실패:', error);
  });

  return client;
}

module.exports = { startDiscordBot };
