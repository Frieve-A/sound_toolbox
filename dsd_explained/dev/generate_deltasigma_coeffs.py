#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Generate ΔΣ noise shaping filter coefficients for various orders, OSR, and bit configurations.
"""

import os
import json
import numpy as np
import argparse
# Monkey-patch for numpy.float alias removed in numpy>=1.20
if not hasattr(np, 'float'):
    np.float = float

# Monkey-patch for fractions.gcd removed in recent Python versions
import fractions
import math
if not hasattr(fractions, 'gcd'):
    fractions.gcd = math.gcd

import sys
import types
# Monkey-patch for missing numpy.distutils.system_info to satisfy deltasigma imports
if 'numpy.distutils' not in sys.modules:
    sys.modules['numpy.distutils'] = types.ModuleType('numpy.distutils')
if 'numpy.distutils.system_info' not in sys.modules:
    sis = types.ModuleType('numpy.distutils.system_info')
    def get_info(*args, **kwargs):
        return {}
    sis.get_info = get_info
    sys.modules['numpy.distutils.system_info'] = sis

# Monkey-patch for scipy.signal.step2 removed in recent SciPy versions
import scipy.signal as signal
if not hasattr(signal, 'step2'):
    signal.step2 = signal

# Monkey-patch for collections.Iterable removed in Python 3.10+
import collections
import collections.abc
if not hasattr(collections, 'Iterable'):
    collections.Iterable = collections.abc.Iterable

# Use synthesizeNTF from python-deltasigma for NTF design
from deltasigma import synthesizeNTF

def parse_args():
    parser = argparse.ArgumentParser(
        description='Generate ΔΣ noise shaping filter coefficients for specified opt and H_inf parameters'
    )
    parser.add_argument('--opt', type=int, default=2, choices=[0,1,2,3,4],
                        help='Zero optimization flag (0-4)')
    parser.add_argument('--H_inf', type=float, default=1.2,
                        help='Lee stability criterion maximum H_inf')
    return parser.parse_args()

def main():
    args = parse_args()
    opt = args.opt
    H_inf = args.H_inf
    orders = list(range(0, 8))
    osrs = [64, 128, 256, 512]
    bits = [1, 2, 3, 4, 5, 6]

    coeffs = {}

    for order in orders:
        coeffs[order] = {}
        for osr in osrs:
            # handle 0th-order (no noise shaping)
            if order == 0:
                zeros, poles, gain = [], [], 1
            else:
                # synthesize noise transfer function with specified optimization and H_inf
                zeros, poles, gain = synthesizeNTF(order=order, osr=osr, opt=opt, H_inf=H_inf, f0=0)
            # prepare zero and pole lists for polynomial generation
            zlist = np.atleast_1d(zeros).tolist()
            plist = np.atleast_1d(poles).tolist()
            # compute numerator and denominator coefficients and convert to real floats
            num_arr = (gain * np.poly(zlist)).real
            den_arr = np.poly(plist).real
            # convert arrays to Python lists of floats
            num = np.atleast_1d(num_arr).tolist()
            den = np.atleast_1d(den_arr).tolist()
            coeffs[order][osr] = {}
            for bit in bits:
                coeffs[order][osr][bit] = {"num": num, "den": den}

    script_dir = os.path.dirname(os.path.abspath(__file__))
    # determine assets directory at project root and create if needed
    project_root = os.path.abspath(os.path.join(script_dir, os.pardir))
    assets_dir = os.path.join(project_root, "assets")
    os.makedirs(assets_dir, exist_ok=True)
    # output JSON to assets folder
    output_path = os.path.join(assets_dir, "deltasigma_coeffs.json")
    with open(output_path, "w") as f:
        json.dump(coeffs, f, indent=2)

    print(f"Generated ΔΣ coefficients JSON at {output_path}")

if __name__ == "__main__":
    main() 