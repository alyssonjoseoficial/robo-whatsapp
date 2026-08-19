const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeLib = require('qrcode');
const axios = require('axios');
const cron = require('node-cron');
const express = require('express');
const puppeteer = require('puppeteer');

// ================= Configurações =================
const API_URL = 'https://kirontech.com.br/api/dashboard/stats.php';
const TARGET_NUMBER = '557988649757@c.us'; // Número de teste do usuário
const PORT = process.env.PORT || 3000;

// Variáveis de estado
let lastKnownNotifications = null;
let qrCodeDataUrl = null; // Armazena a imagem base64 do QR Code
let isConnected = false;

// ================= Servidor Express (Para o Render) =================
const app = express();
app.get('/', (req, res) => {
    if (isConnected) {
        return res.send(`
            <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
                <h1 style="color: green;">✅ Robô Conectado!</h1>
                <p>O sentinela do WhatsApp está monitorando o sistema Control_SADMIN.</p>
            </div>
        res.send('<h1>Robô Conectado!</h1><p>O robô já está monitorando as notificações.</p><p><a href="/test-message" target="_blank">Clique aqui para enviar uma mensagem de teste AGORA</a></p>');
    } else if (qrCodeDataUrl) {
        res.send(`
            <h1>Escaneie o QR Code abaixo com o WhatsApp</h1>
            <p>O QR code atualiza automaticamente a cada 10 segundos.</p>
            <img src="${qrCodeDataUrl}" alt="QR Code" style="max-width: 300px;">
            <script>
                setTimeout(() => { window.location.reload(); }, 10000);
            </script>
        `);
    } else {
        res.send('<h1>Aguardando geração do QR Code...</h1><p>Atualize a página em alguns segundos.</p>');
    }
});

// Rota de teste manual de envio
app.get('/test-message', async (req, res) => {
    if (!isConnected) {
        return res.send('Robô não está conectado ao WhatsApp ainda.');
    }
    try {
        const numberClean = TARGET_NUMBER.replace('@c.us', '');
        // Cria uma variante do número forçando a adição do 9 após o DDD (caso seja 8 dígitos) ou removendo (caso já tenha)
        let numberClean9 = numberClean;
        if (numberClean.length === 12) { // 55 79 88649757 (12 chars) -> adiciona 9
            numberClean9 = numberClean.substring(0, 4) + '9' + numberClean.substring(4);
        } else if (numberClean.length === 13) { // 55 79 988649757 (13 chars) -> tira o 9
            numberClean9 = numberClean.substring(0, 4) + numberClean.substring(5);
        }

        const contactId = await client.getNumberId(numberClean);
        const contactId9 = await client.getNumberId(numberClean9);

        let finalId = contactId || contactId9;
        
        if (finalId) {
            await client.sendMessage(finalId._serialized, '🤖 *Teste do Robô:* A conexão com este número está funcionando perfeitamente!');
            return res.send(`<h3>Sucesso!</h3><p>Mensagem enviada com sucesso para o WhatsApp detectado: <b>${finalId._serialized}</b>.</p><p>Verifique o celular!</p>`);
        } else {
            return res.send(`<h3>Erro de Número</h3><p>Os números <b>${numberClean}</b> e <b>${numberClean9}</b> não foram reconhecidos como válidos pelos servidores do WhatsApp.</p>`);
        }
    } catch (e) {
        return res.send(`<h3>Erro Crítico</h3><p>${e.message}</p>`);
    }
});

app.listen(PORT, () => {
    console.log(`Servidor Express rodando na porta ${PORT}`);
});

// ================= WhatsApp Client =================
const client = new Client({
    authStrategy: new LocalAuth(), // Salva a sessão localmente na pasta .wwebjs_auth
    puppeteer: {
        executablePath: puppeteer.executablePath(),
        args: ['--no-sandbox', '--disable-setuid-sandbox'] // Necessário para rodar em servidores como o Render
    },
    // Correção forçada para usar a versão mais compatível do WhatsApp Web
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1041772087-alpha.html',
    }
});

client.on('qr', (qr) => {
    console.log('QR Code recebido. Acesse o link do Render para escanear a imagem.');
    // Converte a string do QR para uma imagem DataURL (base64)
    qrcodeLib.toDataURL(qr, (err, url) => {
        if (!err) qrCodeDataUrl = url;
    });
});

client.on('ready', () => {
    console.log('Cliente do WhatsApp conectado com sucesso!');
    isConnected = true;
    qrCodeDataUrl = null; // Limpa o QR Code da memória
    
    // Inicia o job de monitoramento
    iniciarMonitoramento();
});

client.on('auth_failure', msg => {
    console.error('Falha na autenticação do WhatsApp:', msg);
});

client.on('disconnected', (reason) => {
    console.log('Cliente desconectado:', reason);
});

client.initialize();

// ================= Lógica do Robô =================
function iniciarMonitoramento() {
    console.log('Iniciando monitoramento da API a cada 1 minuto...');
    
    // Verifica imediatamente ao iniciar
    checarNotificacoes();

    // Configura o cron para rodar a cada 1 minuto
    cron.schedule('* * * * *', () => {
        checarNotificacoes();
    });
}

async function checarNotificacoes() {
    try {
        console.log(`[${new Date().toISOString()}] Checando notificações na Kirontech...`);
        const response = await axios.get(API_URL);
        
        if (response.data && response.data.success && response.data.systems) {
            const systems = response.data.systems;
            
            // Soma todas as notificações de todos os sistemas
            let totalNotifications = 0;
            systems.forEach(sys => {
                // A API mapeou 'support_notifications' para 'notifications'
                totalNotifications += parseInt(sys.notifications || 0, 10);
            });
            
            console.log(`Total de notificações atuais: ${totalNotifications}`);

            if (lastKnownNotifications === null) {
                // Primeira execução: apenas registra o estado atual
                console.log(`Estado inicial registrado: ${totalNotifications} notificações.`);
                lastKnownNotifications = totalNotifications;
                return;
            }

            if (totalNotifications > lastKnownNotifications) {
                const dif = totalNotifications - lastKnownNotifications;
                console.log(`Aumento detectado! ${dif} nova(s) notificação(ões). Enviando WhatsApp...`);
                
                const mensagem = `🚨 *Sentinela Kirontech* 🚨\n\nFoi detectada uma nova movimentação no sistema!\nNovas notificações: *${dif}*\nTotal de notificações pendentes: *${totalNotifications}*\n\nAcesse o painel Control_SADMIN para verificar.`;
                
                // Trata a formatação maluca do WhatsApp para números do Brasil (9º dígito)
                const numberClean = TARGET_NUMBER.replace('@c.us', '');
                const contactId = await client.getNumberId(numberClean);
                
                if (contactId) {
                    await client.sendMessage(contactId._serialized, mensagem);
                    console.log('Mensagem enviada com sucesso para o ID:', contactId._serialized);
                } else {
                    console.error('Erro: O número de destino não foi encontrado no WhatsApp. Verifique se o número está correto.');
                    // Tenta enviar forçado mesmo assim
                    await client.sendMessage(TARGET_NUMBER, mensagem);
                }
                
                lastKnownNotifications = totalNotifications;
            } else if (totalNotifications < lastKnownNotifications) {
                // Se o número diminuiu, significa que alguém atendeu as notificações
                console.log('O número de notificações diminuiu (foram atendidas). Atualizando contador interno.');
                lastKnownNotifications = totalNotifications;
            }
        }
    } catch (error) {
        console.error('Erro ao buscar dados da API:', error.message);
    }
}
