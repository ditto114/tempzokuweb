const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const mysql = require('mysql2/promise');

const TARGET_GUILD_ID = '1433396128224907326';

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'dito1121!',
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
  database: process.env.DB_NAME || 'raid_distribution',
};

function createMemberPool() {
  return mysql.createPool({
    ...dbConfig,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
  });
}

async function fetchMembers(pool) {
  const [rows] = await pool.query(
    'SELECT nickname, job, party, display_order FROM members ORDER BY display_order ASC, id ASC',
  );
  return rows.map((row) => ({
    nickname: row.nickname,
    job: row.job,
    party: row.party,
    displayOrder: row.display_order,
  }));
}

function startDiscordBot(token) {
  if (!token) {
    console.warn('DISCORD_TOKEN이 설정되지 않아 디스코드 봇이 비활성화되었습니다.');
    return null;
  }

  const memberPool = createMemberPool();

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

    if (message.content.trim() === '!목록') {
      fetchMembers(memberPool)
        .then((members) => {
          if (!Array.isArray(members) || members.length === 0) {
            return message.channel.send('등록된 공대원이 없습니다.');
          }

          const orderColumn = members
            .map((member) => (Number.isInteger(member.displayOrder) ? member.displayOrder : '-'))
            .join('\n');
          const nicknameColumn = members
            .map((member) => member.nickname || '-')
            .join('\n');

          const partyMembers = {
            1: [],
            2: [],
            3: [],
          };

          members.forEach((member) => {
            if ([1, 2, 3].includes(Number(member.party))) {
              const nickname = member.nickname || '-';
              const job = member.job || '-';
              partyMembers[Number(member.party)].push(`${nickname} | ${job}`);
            }
          });

          return message.channel.send({
            embeds: [
              {
                title: '공대원 목록',
                fields: [
                  { name: '순번', value: orderColumn, inline: true },
                  { name: '닉네임', value: nicknameColumn, inline: true },
                  { name: '\u200B', value: '\u200B', inline: true },
                  {
                    name: '1파티',
                    value: partyMembers[1].join('\n') || '없음',
                    inline: true,
                  },
                  {
                    name: '2파티',
                    value: partyMembers[2].join('\n') || '없음',
                    inline: true,
                  },
                  {
                    name: '3파티',
                    value: partyMembers[3].join('\n') || '없음',
                    inline: true,
                  },
                ],
              },
            ],
          });
        })
        .catch((error) => {
          console.error('공대원 목록 조회 실패:', error);
          message.channel
            .send('공대원 목록을 불러오는 중 오류가 발생했습니다.')
            .catch((sendError) => console.error('디스코드 메시지 전송 실패:', sendError));
        });
      return;
    }

    if (message.content.trim() === '!DB') {
      (async () => {
        try {
          const [rows] = await memberPool.query(
            'SELECT nickname, job, party, display_order FROM members ORDER BY id ASC',
          );

          const dmChannel = await message.author.createDM();

          const dataLines = rows.map((row) => {
            const partyValue = row.party === null || row.party === undefined ? 'null' : row.party;
            const displayOrderValue =
              row.display_order === null || row.display_order === undefined
                ? 'null'
                : row.display_order;
            return `${row.nickname}/${row.job}/${partyValue}/${displayOrderValue}`;
          });

          await dmChannel.send({
            content: dataLines.length > 0 ? dataLines.join('\n') : '등록된 데이터가 없습니다.',
          });

          await dmChannel.send({
            content:
              '변경할 값을 "닉네임/직업/파티/순번" 형식으로 입력해주세요. (예: 홍길동/비숍/2/1)',
          });

          const collector = dmChannel.createMessageCollector({
            filter: (dmMessage) => dmMessage.author.id === message.author.id,
            max: 1,
            time: 20000,
          });

          collector.on('collect', async (dmMessage) => {
            const input = dmMessage.content.trim();
            const parts = input.split('/');

            if (parts.length !== 4) {
              await dmChannel.send(
                '형식이 올바르지 않습니다. 닉네임/직업/파티/순번 형식으로 입력해주세요.',
              );
              return;
            }

            const [nicknameInput, jobInput, partyInput, displayOrderInput] = parts.map((part) =>
              part.trim(),
            );

            if (!nicknameInput || !jobInput || !partyInput || !displayOrderInput) {
              await dmChannel.send('모든 값을 입력해주세요. (닉네임/직업/파티/순번)');
              return;
            }

            const partyNumber = Number(partyInput);
            const displayOrderNumber = Number(displayOrderInput);

            if (!Number.isInteger(partyNumber) || partyNumber < 1 || partyNumber > 3) {
              await dmChannel.send('파티 값은 1, 2, 3 중 하나의 숫자여야 합니다.');
              return;
            }

            if (!Number.isInteger(displayOrderNumber)) {
              await dmChannel.send('순번 값은 정수여야 합니다.');
              return;
            }

            try {
              const [result] = await memberPool.query(
                'UPDATE members SET job = ?, party = ?, display_order = ? WHERE nickname = ?',
                [jobInput, partyNumber, displayOrderNumber, nicknameInput],
              );

              if (result.affectedRows === 0) {
                await dmChannel.send(`${nicknameInput} 님을 찾을 수 없습니다.`);
                return;
              }

              await dmChannel.send(
                `${nicknameInput}님의 정보가 직업(${jobInput}), 파티(${partyNumber}), 순번(${displayOrderNumber})으로 수정되었습니다.`,
              );
            } catch (updateError) {
              console.error('멤버 정보 업데이트 실패:', updateError);
              await dmChannel.send('멤버 정보를 업데이트하는 중 오류가 발생했습니다.');
            }
          });

          collector.on('end', (collected) => {
            if (collected.size === 0) {
              dmChannel
                .send('시간 초과')
                .catch((timeoutError) => console.error('시간 초과 메시지 전송 실패:', timeoutError));
            }
          });
        } catch (error) {
          console.error('DB 조회 실패:', error);
          message.author
            .send('DB 데이터를 불러오는 중 오류가 발생했습니다.')
            .catch((sendError) => console.error('DM 전송 실패:', sendError));
        }
      })();

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
