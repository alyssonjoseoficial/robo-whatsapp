const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeLib = require('qrcode');
const axios = require('axios');
const cron = require('node-cron');
const express = require('express');
const puppeteer = require('puppeteer');

// ================= Configurações =================
const API_URL = 'https://kirontech.com.br/api/dashboard/stats.php';
const TARGET_NUMBER = '5579998781719@c.us'; // Número de destino com o sufixo do WhatsApp
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
        `);
    }

    if (qrCodeDataUrl) {
        return res.send(`
            <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
                <h2>Abra o WhatsApp no celular e escaneie o código abaixo:</h2>
                <img src="${qrCodeDataUrl}" alt="QR Code do WhatsApp" style="width: 300px; height: 300px; border: 2px solid #ccc; border-radius: 10px; padding: 10px;" />
                <p><i>A página recarregará sozinha a cada 10 segundos...</i></p>
                <script>setTimeout(() => window.location.reload(), 10000);</script>
            </div>
        `);
    }

    res.send('Aguardando a geração do QR Code... Atualize a página em alguns segundos.');
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
                
                await client.sendMessage(TARGET_NUMBER, mensagem);
                console.log('Mensagem enviada com sucesso!');
                
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
