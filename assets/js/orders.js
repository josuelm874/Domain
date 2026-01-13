(function() {
    try {
        const Orders = [
            {
                productName: 'Sitram',
                productNumber: 'A & R Comercial',
                paymentStatus: '09:15 - 01/09',
                status: 'Completed'
            },
            {
                productName: 'ISS',
                productNumber: 'F H Carneiro',
                paymentStatus: '14:20 - 02/09',
                status: 'Divergence'
            },
            {
                productName: 'Doc',
                productNumber: 'E F de Luna',
                paymentStatus: '16:45 - 03/09',
                status: 'Completed'
            },
            {
                productName: 'NF-e Entrada',
                productNumber: 'Frig. Ponto do Carneiro',
                paymentStatus: '11:30 - 04/09',
                status: 'Divergence'
            },
            {
                productName: 'NF-e Saída',
                productNumber: 'A & R Comercial',
                paymentStatus: '08:50 - 05/09',
                status: 'Completed'
            },
            {
                productName: 'CF-e | NFC-e',
                productNumber: 'F H Carneiro',
                paymentStatus: '13:10 - 06/09',
                status: 'Divergence'
            },
            {
                productName: 'ICMS ST 1104',
                productNumber: 'E F de Luna',
                paymentStatus: '17:25 - 07/09',
                status: 'Completed'
            },
            {
                productName: 'MIT',
                productNumber: 'Frig. Ponto do Carneiro',
                paymentStatus: '10:00 - 08/09',
                status: 'Divergence'
            },
            {
                productName: 'DIRBI',
                productNumber: 'A & R Comercial',
                paymentStatus: '15:40 - 09/09',
                status: 'Completed'
            },
            {
                productName: 'EFD Fiscal',
                productNumber: 'F H Carneiro',
                paymentStatus: '12:15 - 10/09',
                status: 'Divergence'
            },
            {
                productName: 'EFD Contribuições',
                productNumber: 'E F de Luna',
                paymentStatus: '09:30 - 11/09',
                status: 'Completed'
            },
            {
                productName: 'Sitram',
                productNumber: 'Frig. Ponto do Carneiro',
                paymentStatus: '14:50 - 12/09',
                status: 'Divergence'
            },
            {
                productName: 'ISS',
                productNumber: 'A & R Comercial',
                paymentStatus: '16:10 - 13/09',
                status: 'Completed'
            },
            {
                productName: 'Doc',
                productNumber: 'F H Carneiro',
                paymentStatus: '11:20 - 14/09',
                status: 'Divergence'
            },
            {
                productName: 'NF-e Entrada',
                productNumber: 'E F de Luna',
                paymentStatus: '08:45 - 15/09',
                status: 'Completed'
            },
            {
                productName: 'NF-e Saída',
                productNumber: 'Frig. Ponto do Carneiro',
                paymentStatus: '13:30 - 16/09',
                status: 'Divergence'
            },
            {
                productName: 'CF-e | NFC-e',
                productNumber: 'A & R Comercial',
                paymentStatus: '17:00 - 17/09',
                status: 'Completed'
            },
            {
                productName: 'ICMS ST 1104',
                productNumber: 'F H Carneiro',
                paymentStatus: '10:25 - 18/09',
                status: 'Divergence'
            },
            {
                productName: 'MIT',
                productNumber: 'E F de Luna',
                paymentStatus: '15:15 - 19/09',
                status: 'Completed'
            },
            {
                productName: 'DIRBI',
                productNumber: 'Frig. Ponto do Carneiro',
                paymentStatus: '12:40 - 20/09',
                status: 'Divergence'
            }
        ];
        window.Orders = Orders;
        console.log('orders.js carregado, window.Orders definido:', window.Orders);
    } catch (e) {
        console.error('Erro em orders.js:', e);
    }
})();