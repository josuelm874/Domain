import subprocess
import sys
import importlib.util

# Bibliotecas necessárias para a automação
BIBLIOTECAS_NECESSARIAS = ['pyautogui']

def verificar_e_instalar_bibliotecas():
    """Verifica e instala/atualiza todas as bibliotecas necessárias"""
    print("🔍 Verificando bibliotecas necessárias...")
    
    bibliotecas_faltando = []
    bibliotecas_instaladas = []
    
    # Verificar quais bibliotecas estão instaladas
    for biblioteca in BIBLIOTECAS_NECESSARIAS:
        spec = importlib.util.find_spec(biblioteca)
        if spec is None:
            bibliotecas_faltando.append(biblioteca)
            print(f"  ❌ {biblioteca} - não instalada")
        else:
            bibliotecas_instaladas.append(biblioteca)
            print(f"  ✅ {biblioteca} - instalada")
    
    # Instalar bibliotecas faltando
    if bibliotecas_faltando:
        print(f"\n📦 Instalando {len(bibliotecas_faltando)} biblioteca(s) faltando...")
        for biblioteca in bibliotecas_faltando:
            try:
                print(f"  ⬇️ Instalando {biblioteca}...")
                subprocess.check_call([sys.executable, '-m', 'pip', 'install', biblioteca, '--quiet', '--upgrade'], 
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                print(f"  ✅ {biblioteca} instalada com sucesso")
            except subprocess.CalledProcessError:
                print(f"  ❌ Erro ao instalar {biblioteca}")
                return False
    
    # Atualizar todas as bibliotecas para versões mais recentes
    if bibliotecas_instaladas:
        print(f"\n🔄 Atualizando {len(bibliotecas_instaladas)} biblioteca(s) para versões mais recentes...")
        for biblioteca in bibliotecas_instaladas:
            try:
                subprocess.check_call([sys.executable, '-m', 'pip', 'install', '--upgrade', biblioteca, '--quiet'], 
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                print(f"  ✅ {biblioteca} atualizada")
            except subprocess.CalledProcessError:
                print(f"  ⚠️ Aviso: não foi possível atualizar {biblioteca} (pode já estar na versão mais recente)")
    
    print("✅ Verificação de bibliotecas concluída!\n")
    return True

# Verificar e instalar bibliotecas antes de importar
if not verificar_e_instalar_bibliotecas():
    print("❌ Erro ao verificar/instalar bibliotecas. Encerrando...")
    sys.exit(1)

import pyautogui
import time

# Solicitar número de ciclos ao usuário
try:
    total_ciclos = int(input("Digite o número de ciclos a executar: "))
    if total_ciclos <= 0:
        print("❌ Número inválido. O número de ciclos deve ser maior que zero.")
        sys.exit(1)
except ValueError:
    print("❌ Entrada inválida. Por favor, digite um número inteiro.")
    sys.exit(1)
except KeyboardInterrupt:
    print("\n❌ Operação cancelada pelo usuário.")
    sys.exit(1)

# Espera 5 segundos antes de começar
print(f"\n⏳ Você tem 5 segundos para posicionar a janela correta...")
time.sleep(5)

print(f"🚀 Iniciando {total_ciclos} ciclos...")

for i in range(total_ciclos):
    pyautogui.press('f4')
    pyautogui.press('left')
    pyautogui.press('enter')
    # Pequeno delay entre ciclos, opcional
    time.sleep(0.1)

print("Ciclos concluídos.")
