import pyautogui
import time

# Espera 5 segundos antes de começar
print("Esperando 5 segundos...")
time.sleep(5)

# Número de ciclos
total_ciclos = 2304

print(f"Iniciando {total_ciclos} ciclos...")

for i in range(total_ciclos):
    pyautogui.press('f4')
    pyautogui.press('left')
    pyautogui.press('enter')
    # Pequeno delay entre ciclos, opcional
    time.sleep(0.1)

print("Ciclos concluídos.")
